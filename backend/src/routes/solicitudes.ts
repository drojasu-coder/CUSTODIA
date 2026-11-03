import { Router } from 'express';
import { z } from 'zod';
import { audit, evento } from '../audit';
import { codigoNuevo, expirarSolicitudes } from '../access';
import { requirePermission } from '../auth';
import { one, pool, q, tx } from '../db';
import { bad, conflict, forbidden, notFound, wrap , idParam } from '../errors';
import { cabecerasDescarga, guardar, leer } from '../storage';
import { pageParams, sha256 } from '../util';

export const solicitudesRouter = Router();
const SEL = `select s.*, ev.codigo_unico, ev.nombre_referencia, ev.id_caso, ca.codigo_caso, ca.estado as estado_caso,
    so.nombres||' '||so.apellidos as solicitante, sp.nombres||' '||sp.apellidos as supervisor,
    cp.id_copia, cp.codigo as codigo_copia,
    (s.estado='aprobada' and s.fecha_vencimiento>=hoy_gt()) as vigente
  from solicitudes_acceso s join evidencias ev using(id_evidencia) join casos ca using(id_caso)
  join usuarios so on so.id_usuario=s.id_solicitante left join usuarios sp on sp.id_usuario=s.id_supervisor
  left join copias_autorizadas cp on cp.id_solicitud=s.id_solicitud`;

solicitudesRouter.get('/', requirePermission('consultar_solicitudes'), wrap(async (req, res) => {
  const u = req.user!, { page, size, offset } = pageParams(req.query);
  await expirarSolicitudes();
  const full = ['Supervisor', 'Auditor'].includes(u.rol);
  const estado = typeof req.query.estado === 'string' && req.query.estado ? req.query.estado : null;
  const p = [full, u.id, estado], w = `($1::boolean or s.id_solicitante=$2) and ($3::text is null or s.estado::text=$3)`;
  const total = (await one(pool, `select count(*)::int n from solicitudes_acceso s where ${w}`, p))!.n;
  const items = await q(pool, `${SEL} where ${w} order by s.id_solicitud desc limit $4 offset $5`, [...p, size, offset]);
  res.json({ total, page, size, items });
}));

solicitudesRouter.post('/', requirePermission('solicitar_acceso'), wrap(async (req, res) => {
  const u = req.user!;
  const b = z.object({
    codigo_evidencia: z.string().trim().min(3).max(40),
    motivo: z.string().trim().min(10, 'Explique el motivo (mínimo 10 caracteres).').max(250),
    dias: z.number().int().min(1).max(30).optional(),
  }).parse(req.body);
  const dias = b.dias ?? Number((await one(pool, `select valor from configuracion where clave='vigencia_acceso_dias'`))!.valor);
  const sol = await tx(async c => {
    const ev = await one(c, `select e.*, ca.estado as estado_caso from evidencias e join casos ca using(id_caso) where upper(e.codigo_unico)=upper($1)`, [b.codigo_evidencia]);
    if (!ev) {
      await audit(c, u, req, { modulo: 'Accesos', accion: 'Solicitud de acceso', referencia: b.codigo_evidencia, resultado: 'rechazado', descripcion: 'Código de evidencia inexistente.' });
      throw bad('No existe una evidencia con ese código.');
    }
    if (['cerrado', 'archivado'].includes(ev.estado_caso)) throw conflict('El caso de esa evidencia está cerrado.');
    const dup = await one(c, `select 1 from solicitudes_acceso where id_evidencia=$1 and id_solicitante=$2 and (estado='pendiente' or (estado='aprobada' and fecha_vencimiento>=hoy_gt()))`, [ev.id_evidencia, u.id]);
    if (dup) throw conflict('Ya tiene una solicitud pendiente o vigente para esta evidencia.');
    const codigo = await codigoNuevo(c, 'SOL');
    const s = await one(c, `insert into solicitudes_acceso (codigo,id_evidencia,id_solicitante,alcance,motivo,fecha_vencimiento)
      values ($1,$2,$3,'copia_trabajo',$4, hoy_gt() + $5::int) returning *`, [codigo, ev.id_evidencia, u.id, b.motivo, dias]);
    await evento(c, u, ev, 'Solicitud de acceso', `${codigo}: ${b.motivo}`);
    await audit(c, u, req, { modulo: 'Accesos', accion: 'Solicitud de acceso', referencia: codigo, id_caso: ev.id_caso, id_evidencia: ev.id_evidencia, descripcion: b.motivo });
    return s;
  });
  res.status(201).json(sol);
}));

solicitudesRouter.post('/:id/decidir', requirePermission('decidir_solicitud'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const b = z.object({ decision: z.enum(['aprobar', 'rechazar']), observaciones: z.string().trim().min(5, 'Documente su decisión (mínimo 5 caracteres).').max(500) }).parse(req.body);
  const out = await tx(async c => {
    const s = await one(c, `${SEL} where s.id_solicitud=$1 for update of s`, [id]);
    if (!s) throw notFound('Solicitud no encontrada.');
    if (s.estado !== 'pendiente') throw conflict('La solicitud ya fue resuelta.');
    if (s.id_solicitante === u.id) throw forbidden('No puede resolver una solicitud propia.');
    const ev = await one(c, 'select * from evidencias where id_evidencia=$1', [s.id_evidencia]);
    if (b.decision === 'rechazar') {
      await q(c, `update solicitudes_acceso set estado='rechazada', id_supervisor=$2, fecha_respuesta=now(), observaciones_supervisor=$3 where id_solicitud=$1`, [id, u.id, b.observaciones]);
      await evento(c, u, ev, 'Solicitud rechazada', `${s.codigo}: ${b.observaciones}`);
      await audit(c, u, req, { modulo: 'Accesos', accion: 'Rechazo de solicitud', referencia: s.codigo, id_caso: s.id_caso, id_evidencia: s.id_evidencia, descripcion: b.observaciones, resultado: 'rechazado' });
      return { estado: 'rechazada' };
    }
    if (s.fecha_vencimiento < new Date(new Date().toISOString().slice(0, 10))) throw conflict('La vigencia solicitada ya venció.');
    if (['cerrado', 'archivado'].includes(s.estado_caso)) throw conflict('El caso está cerrado.');
    if (['no_coincide', 'en_revision'].includes(ev.integridad)) throw conflict('No se emiten copias de una evidencia con discrepancia de integridad sin resolver.');
    // La copia solo se emite si el original almacenado sigue coincidiendo con su hash inicial.
    const orig = await one(c, `select * from archivos_evidencia where id_evidencia=$1 and es_archivo_original limit 1`, [s.id_evidencia]);
    if (!orig) throw bad('La evidencia no tiene archivo para copiar.');
    const buf = await leer(c, orig.ruta_almacenamiento), hash = sha256(buf);
    if (hash !== ev.hash_inicial) throw conflict('El original almacenado no coincide con su hash inicial: verifique la integridad antes de emitir copias.');
    await q(c, `update solicitudes_acceso set estado='aprobada', id_supervisor=$2, fecha_respuesta=now(), observaciones_supervisor=$3 where id_solicitud=$1`, [id, u.id, b.observaciones]);
    const n = (await one(c, 'select count(*)::int n from copias_autorizadas where id_evidencia=$1', [s.id_evidencia]))!.n + 1;
    const codCopia = `COPY-${ev.codigo_unico}-${String(n).padStart(3, '0')}`;
    const copia = await one(c, `insert into copias_autorizadas (codigo,id_evidencia,id_solicitud,id_propietario,hash_sha256) values ($1,$2,$3,$4,$5) returning *`,
      [codOrFail(codCopia), s.id_evidencia, id, s.id_solicitante, hash]);
    await q(c, `insert into archivos_evidencia (codigo,id_evidencia,id_copia,nombre_original,tipo_mime,extension,tamano_bytes,ruta_almacenamiento,hash_sha256,id_usuario_carga,es_archivo_original)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
      ['COPY-FIL-' + codCopia, s.id_evidencia, copia.id_copia, 'copia_autorizada_' + orig.nombre_original, orig.tipo_mime, orig.extension, orig.tamano_bytes, await guardar(c, buf, 'copias'), hash, u.id]);
    await evento(c, u, ev, 'Copia autorizada emitida', `${s.codigo} aprobada; ${codCopia} para ${s.solicitante}. El original no se entrega.`);
    await audit(c, u, req, { modulo: 'Accesos', accion: 'Aprobación de solicitud', referencia: s.codigo, id_caso: s.id_caso, id_evidencia: s.id_evidencia, descripcion: `Copia ${codCopia}` });
    return { estado: 'aprobada', copia: codCopia };
  });
  res.json(out);
}));
const codOrFail = (c: string) => c;

solicitudesRouter.get('/:id/copia', requirePermission('descargar_copia'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const s = await one(pool, `${SEL} where s.id_solicitud=$1`, [id]);
  if (!s || s.id_solicitante !== u.id) throw notFound('Solicitud no encontrada.');
  if (!s.vigente) throw forbidden('La solicitud no está vigente (venció o no fue aprobada).');
  const f = await one(pool, `select * from archivos_evidencia where id_copia=$1`, [s.id_copia]);
  if (!f) throw notFound('La copia no está disponible.');
  const buf = await leer(pool, f.ruta_almacenamiento);
  await audit(pool, u, req, { modulo: 'Accesos', accion: 'Descarga de copia autorizada', referencia: s.codigo_copia, id_caso: s.id_caso, id_evidencia: s.id_evidencia });
  if (sha256(buf) !== f.hash_sha256) throw conflict('La copia almacenada no coincide con su huella registrada.');
  res.set(cabecerasDescarga(f.nombre_original, f.hash_sha256)).send(buf);
}));
