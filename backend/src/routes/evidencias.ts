import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { z } from 'zod';
import { audit, evento } from '../audit';
import { casoAbierto, casoVisible, codigoNuevo, evidenciaVisible } from '../access';
import { hasPerm, requirePermission } from '../auth';
import { one, pool, q, tx } from '../db';
import { bad, conflict, forbidden, wrap , idParam } from '../errors';
import { cabecerasDescarga, guardar, leer, maxArchivoBytes, nombreSeguro, validarAdjunto } from '../storage';
import { isHash, pageParams, sha256 } from '../util';

export const evidenciasRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxArchivoBytes(), files: 1 } });

evidenciasRouter.get('/', requirePermission('consultar_evidencias'), wrap(async (req, res) => {
  const u = req.user!, { page, size, offset } = pageParams(req.query);
  const f = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : null);
  const busq = f('q') ? `%${f('q')}%` : null;
  const params = [u.id, u.rol, f('estado'), f('integridad'), f('id_caso') ? Number(f('id_caso')) : null, busq];
  const where = `puede_ver_evidencia($1,$2,e.id_evidencia) and ($3::text is null or e.estado::text=$3) and ($4::text is null or e.integridad::text=$4)
    and ($5::int is null or e.id_caso=$5) and ($6::text is null or e.codigo_unico ilike $6 or e.nombre_referencia ilike $6 or e.numero_serie ilike $6)`;
  const total = (await one(pool, `select count(*)::int n from evidencias e where ${where}`, params))!.n;
  const items = await q(pool, `select e.id_evidencia, e.codigo_unico, e.nombre_referencia, t.nombre as tipo, e.estado, e.integridad, e.fecha_recoleccion,
      c.codigo_caso, e.id_caso, ub.nombre as ubicacion, cu.nombres||' '||cu.apellidos as custodio
    from evidencias e join tipos_evidencia t using(id_tipo) join casos c using(id_caso) join ubicaciones ub using(id_ubicacion)
    join usuarios cu on cu.id_usuario=e.id_custodio_actual
    where ${where} order by e.fecha_registro desc, e.id_evidencia desc limit $7 offset $8`, [...params, size, offset]);
  res.json({ total, page, size, items });
}));

evidenciasRouter.post('/', requirePermission('registrar_evidencia'), upload.single('archivo'), wrap(async (req, res) => {
  const b = z.object({
    id_caso: z.coerce.number().int(), id_tipo: z.coerce.number().int(),
    nombre_referencia: z.string().trim().min(3).max(150), descripcion: z.string().trim().min(5).max(3000),
    marca: z.string().trim().max(80).optional(), modelo: z.string().trim().max(80).optional(),
    numero_serie: z.string().trim().max(100).optional(), capacidad_almacenamiento: z.string().trim().max(50).optional(),
    estado_fisico: z.string().trim().max(100).optional(),
    lugar_recoleccion: z.string().trim().min(3).max(180), fecha_recoleccion: z.coerce.date(),
    id_ubicacion: z.coerce.number().int(), observaciones: z.string().trim().max(2000).optional(),
  }).parse(req.body);
  const file = req.file;
  if (!file || !file.size) throw bad('Adjunte el archivo de la evidencia (el sistema calcula su huella SHA-256).');
  const maxKb = Math.min(Number((await one(pool, `select valor from configuracion where clave='max_adjunto_kb'`))!.valor), maxArchivoBytes() / 1024);
  if (file.size > maxKb * 1024) throw bad(`El archivo excede el máximo permitido (${maxKb} KB).`);
  if (b.fecha_recoleccion.getTime() > Date.now() + 60_000) throw bad('La fecha de recolección no puede ser futura.');
  if (b.fecha_recoleccion.getTime() < Date.parse('2000-01-01')) throw bad('La fecha de recolección no es válida.');
  // busboy entrega el nombre en latin1: se recupera el UTF-8 original solo si es necesario.
  const crudo = file.originalname, dec = Buffer.from(crudo, 'latin1').toString('utf8');
  const nombreArchivo = nombreSeguro(/[\u0080-\u00ff]/.test(crudo) && !/[^\u0000-\u00ff]/.test(crudo) && !dec.includes('\uFFFD') ? dec : crudo);
  const ext = validarAdjunto(nombreArchivo, file.buffer);

  const out = await tx(async c => {
    const caso = await casoVisible(req.user!, b.id_caso, c); casoAbierto(caso);
    const tipo = await one(c, 'select 1 from tipos_evidencia where id_tipo=$1 and activo', [b.id_tipo]);
    if (!tipo) throw bad('Tipo de evidencia inválido.');
    const ub = await one(c, `select u.*, (select count(*)::int from evidencias e where e.id_ubicacion=u.id_ubicacion and e.estado<>'archivada') as ocupados
        from ubicaciones u where id_ubicacion=$1 and activo for update`, [b.id_ubicacion]);
    if (!ub) throw bad('Ubicación inválida o inactiva.');
    if (ub.ocupados >= ub.capacidad) throw conflict(`La ubicación "${ub.nombre}" alcanzó su capacidad (${ub.capacidad}).`);
    const hash = sha256(file.buffer);
    const codigo = await codigoNuevo(c, 'EVI');
    const ev = await one(c, `insert into evidencias (id_caso,codigo_unico,codigo_qr,id_tipo,nombre_referencia,descripcion,marca,modelo,numero_serie,
        capacidad_almacenamiento,estado_fisico,lugar_recoleccion,fecha_recoleccion,id_recolector,id_custodio_actual,id_ubicacion,estado,hash_inicial,observaciones)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,'en_custodia',$16,$17) returning *`,
      [b.id_caso, codigo, 'QR-' + codigo, b.id_tipo, b.nombre_referencia, b.descripcion, b.marca ?? null, b.modelo ?? null, b.numero_serie ?? null,
       b.capacidad_almacenamiento ?? null, b.estado_fisico ?? null, b.lugar_recoleccion, b.fecha_recoleccion, req.user!.id, b.id_ubicacion, hash, b.observaciones ?? null]);
    const rel = await guardar(c, file.buffer, 'originales');
    await q(c, `insert into archivos_evidencia (codigo,id_evidencia,nombre_original,tipo_mime,extension,tamano_bytes,ruta_almacenamiento,hash_sha256,id_usuario_carga)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      ['FIL-' + codigo, ev.id_evidencia, nombreArchivo, (file.mimetype || 'application/octet-stream').slice(0, 100), ext, file.size, rel, hash, req.user!.id]);
    await q(c, `insert into registros_hash (id_evidencia,tipo_registro,valor_hash,modo,id_usuario,resultado,observaciones) values ($1,'inicial',$2,'inicial',$3,'no_aplica','Huella inicial calculada al registrar el original.')`,
      [ev.id_evidencia, hash, req.user!.id]);
    await q(c, `insert into registros_custodia (id_evidencia,id_custodio,id_ubicacion,ubicacion,observaciones) values ($1,$2,$3,$4,'Custodia inicial del recolector.')`,
      [ev.id_evidencia, req.user!.id, b.id_ubicacion, ub.nombre]);
    await evento(c, req.user!, ev, 'Registro y recolección', 'Registro del original y huella digital SHA-256 del archivo.');
    await audit(c, req.user!, req, { modulo: 'Evidencias', accion: 'Registro de evidencia', referencia: codigo, id_caso: b.id_caso, id_evidencia: ev.id_evidencia, descripcion: b.nombre_referencia });
    return ev;
  });
  res.status(201).json(out);
}));

evidenciasRouter.get('/:id', requirePermission('consultar_evidencias'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const ev = await evidenciaVisible(u, id);
  const full = ['Supervisor', 'Auditor'].includes(u.rol);
  const archivos = await q(pool, `select id_archivo,codigo,nombre_original,tipo_mime,tamano_bytes,hash_sha256,fecha_carga,es_archivo_original,id_copia
      from archivos_evidencia where id_evidencia=$1 and es_archivo_original order by id_archivo`, [id]);
  const custodia = await q(pool, `select r.*, us.nombres||' '||us.apellidos as custodio from registros_custodia r join usuarios us on us.id_usuario=r.id_custodio where id_evidencia=$1 order by id_custodia`, [id]);
  const eventos = await q(pool, `select * from eventos_custodia where id_evidencia=$1 order by fecha, id_evento`, [id]);
  const verificaciones = await q(pool, `select r.*, us.nombres||' '||us.apellidos as usuario from registros_hash r join usuarios us using(id_usuario) where id_evidencia=$1 order by id_registro_hash`, [id]);
  const alertas = await q(pool, `select * from alertas_integridad where id_evidencia=$1 order by id_alerta`, [id]);
  const transferencias = await q(pool, `select t.*, e.nombres||' '||e.apellidos as entregante, r.nombres||' '||r.apellidos as receptor, ub.nombre as ubicacion_destino
      from transferencias_custodia t join usuarios e on e.id_usuario=t.id_entregante join usuarios r on r.id_usuario=t.id_receptor
      join ubicaciones ub on ub.id_ubicacion=t.id_ubicacion_destino where t.id_evidencia=$1 order by t.id_transferencia`, [id]);
  const solicitudes = await q(pool, `select s.*, us.nombres||' '||us.apellidos as solicitante from solicitudes_acceso s join usuarios us on us.id_usuario=s.id_solicitante
      where s.id_evidencia=$1 and ($2::boolean or s.id_solicitante=$3) order by s.id_solicitud`, [id, full, u.id]);
  const analisis = await q(pool, `select a.id_analisis,a.codigo,a.proposito,a.fecha_registro,us.nombres||' '||us.apellidos as analista from analisis_forenses a join usuarios us on us.id_usuario=a.id_analista
      where a.id_evidencia=$1 and ($2::boolean or a.id_analista=$3) order by a.id_analisis`, [id, full, u.id]);
  res.json({ ...ev, archivos, custodia, eventos, verificaciones, alertas, transferencias, solicitudes, analisis,
    puede_verificar: hasPerm(u, 'verificar_integridad') && (u.rol === 'Supervisor' || ev.id_custodio_actual === u.id) });
}));

evidenciasRouter.get('/:id/qr', requirePermission('consultar_evidencias'), wrap(async (req, res) => {
  const ev = await evidenciaVisible(req.user!, idParam(req));
  const svg = await QRCode.toString(`${ev.codigo_qr}|${ev.codigo_unico}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
}));

evidenciasRouter.get('/:id/original', requirePermission('descargar_original'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const ev = await evidenciaVisible(u, id);
  if (u.rol !== 'Supervisor' && ev.id_custodio_actual !== u.id) throw forbidden('Solo el custodio actual o el Supervisor pueden descargar el original.');
  const f = await one(pool, `select * from archivos_evidencia where id_evidencia=$1 and es_archivo_original limit 1`, [id]);
  if (!f) throw bad('La evidencia no tiene archivo asociado.');
  const buf = await leer(pool, f.ruta_almacenamiento);
  await audit(pool, u, req, { modulo: 'Evidencias', accion: 'Descarga de original', referencia: ev.codigo_unico, id_caso: ev.id_caso, id_evidencia: id, descripcion: f.nombre_original });
  if (sha256(buf) !== f.hash_sha256) throw conflict('El archivo almacenado no coincide con su huella registrada: ejecute una verificación de integridad.');
  res.set(cabecerasDescarga(f.nombre_original, f.hash_sha256)).send(buf);
}));

// ---------------------------------------------------------------- verificación de integridad
evidenciasRouter.post('/:id/verificar', requirePermission('verificar_integridad'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const b = z.object({
    modo: z.enum(['almacenado', 'externo', 'simulacion']),
    hash_externo: z.string().trim().optional(),
    observaciones: z.string().trim().max(1000).optional(),
  }).parse(req.body);

  const out = await tx(async c => {
    const ev = await evidenciaVisible(u, id, c);
    if (u.rol !== 'Supervisor' && ev.id_custodio_actual !== u.id) throw forbidden('Solo el custodio actual o el Supervisor verifican la integridad.');
    await q(c, 'select 1 from evidencias where id_evidencia=$1 for update', [id]);
    let obtenido: string;
    if (b.modo === 'almacenado') {
      const f = await one(c, `select ruta_almacenamiento from archivos_evidencia where id_evidencia=$1 and es_archivo_original limit 1`, [id]);
      if (!f) throw bad('La evidencia no tiene archivo asociado.');
      obtenido = sha256(await leer(c, f.ruta_almacenamiento));
    } else if (b.modo === 'externo') {
      if (!b.hash_externo || !isHash(b.hash_externo)) throw bad('Ingrese un hash SHA-256 válido (64 caracteres hexadecimales).');
      obtenido = b.hash_externo.toLowerCase();
    } else {
      obtenido = sha256(crypto.randomBytes(32));   // simulación académica de una discrepancia
    }
    const coincide = obtenido === ev.hash_inicial;
    const codigo = await codigoNuevo(c, 'VER');
    const reg = await one(c, `insert into registros_hash (codigo,id_evidencia,tipo_registro,valor_hash,hash_esperado,modo,id_usuario,resultado,observaciones)
      values ($1,$2,'verificacion',$3,$4,$5,$6,$7,$8) returning *`,
      [codigo, id, obtenido, ev.hash_inicial, b.modo, u.id, coincide ? 'coincide' : 'no_coincide', b.observaciones ?? null]);
    const abierta = await one(c, `select * from alertas_integridad where id_evidencia=$1 and estado in ('pendiente','en_revision') order by id_alerta limit 1`, [id]);
    let alerta = null, resuelta = false;

    if (!coincide) {
      if (abierta) {
        await q(c, `insert into alertas_historial (id_alerta,id_usuario,accion,notas) values ($1,$2,'Nueva discrepancia',$3)`, [abierta.id_alerta, u.id, `Verificación ${codigo}: el hash sigue sin coincidir.`]);
        alerta = abierta;
      } else {
        const ac = await codigoNuevo(c, 'ALT');
        alerta = await one(c, `insert into alertas_integridad (codigo,id_evidencia,id_registro_hash,nivel,descripcion,hash_esperado,hash_observado)
          values ($1,$2,$3,'critica',$4,$5,$6) returning *`,
          [ac, id, reg.id_registro_hash, `El hash verificado (${codigo}) no coincide con el hash inicial de ${ev.codigo_unico}.`, ev.hash_inicial, obtenido]);
        await q(c, `insert into alertas_historial (id_alerta,id_usuario,accion,notas) values ($1,$2,'Alerta generada',$3)`, [alerta.id_alerta, u.id, `Generada por la verificación ${codigo}.`]);
      }
      await q(c, `update evidencias set integridad='no_coincide', estado='con_alerta', hash_ultima_verificacion=$2 where id_evidencia=$1 and integridad<>'en_revision'`, [id, obtenido]);
      await q(c, `update evidencias set hash_ultima_verificacion=$2 where id_evidencia=$1`, [id, obtenido]);
    } else {
      // Una verificación coincidente resuelve la alerta solo si el Supervisor ya la tomó en revisión (RN-24).
      if (abierta && abierta.estado === 'en_revision') {
        await q(c, `update alertas_integridad set estado='resuelta', fecha_resolucion=now(), resolucion=$2 where id_alerta=$1`, [abierta.id_alerta, `Resuelta por la verificación ${codigo}, que coincide con el hash inicial.`]);
        await q(c, `insert into alertas_historial (id_alerta,id_usuario,accion,notas) values ($1,$2,'Alerta resuelta',$3)`, [abierta.id_alerta, u.id, `Verificación ${codigo} coincidente.`]);
        await q(c, `update evidencias set integridad='verificada', estado='en_custodia', hash_ultima_verificacion=$2 where id_evidencia=$1`, [id, obtenido]);
        resuelta = true;
      } else if (abierta) {
        await q(c, `update evidencias set hash_ultima_verificacion=$2 where id_evidencia=$1`, [id, obtenido]);
      } else {
        await q(c, `update evidencias set integridad='verificada', hash_ultima_verificacion=$2 where id_evidencia=$1`, [id, obtenido]);
      }
    }
    await evento(c, u, ev, coincide ? 'Verificación de integridad' : 'Discrepancia de integridad',
      coincide ? `Verificación ${codigo} coincide con el hash inicial.` : `Verificación ${codigo} NO coincide. ${alerta ? 'Alerta ' + alerta.codigo + '.' : ''} El hash inicial permanece intacto.`);
    await audit(c, u, req, { modulo: 'Integridad', accion: coincide ? 'Verificación coincidente' : 'Discrepancia de integridad', referencia: codigo,
      id_caso: ev.id_caso, id_evidencia: id, resultado: coincide ? 'exitoso' : 'critico', descripcion: `Modo: ${b.modo}` });
    return { verificacion: reg, coincide, alerta, alerta_resuelta: resuelta };
  });
  res.status(201).json(out);
}));
