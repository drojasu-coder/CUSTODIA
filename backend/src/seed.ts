// Datos de demostración FICTICIOS (RN-25). Reproduce el escenario del prototipo.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from './config';
import { one, pool, q, tx } from './db';
import { migrate } from './migrate';
import { guardar } from './storage';
import { sha256 } from './util';

const at = (d: string, t = '08:00') => `${d}T${t}:00-06:00`;

/**
 * Contraseña de las cuentas ficticias. En desarrollo/pruebas: DEMO_PASSWORD o 'Demo123!'.
 * En producción nunca se usa una clave fija: DEMO_PASSWORD (>=12 caracteres) o una aleatoria
 * que se muestra una sola vez en el log del servidor.
 */
function demoPassword(): string {
  const p = process.env.DEMO_PASSWORD;
  if (!config.isProd) return p || 'Demo123!';
  if (p) {
    if (p.length < 12 || p === 'Demo123!' || !/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new Error('DEMO_PASSWORD debe tener al menos 12 caracteres, letras y números.');
    return p;
  }
  // Sin DEMO_PASSWORD las cuentas reciben una clave aleatoria que no se muestra en ningún sitio (quedan
  // inaccesibles hasta que el Administrador les restablezca la contraseña). Nunca se registra en logs.
  console.warn('[seed] DEMO_PASSWORD no definida: las cuentas de demostración se crean con una clave aleatoria no divulgada.');
  return 'Dm' + crypto.randomBytes(18).toString('base64url') + '7';
}

export async function seed(): Promise<boolean> {
  // Solo en una base sin casos ni cuentas de demostración (el admin inicial no lo impide).
  const ya = await one(pool, `select (select count(*) from casos)::int + (select count(*) from usuarios where codigo ~ '^USR-0[1-7]$' or correo ilike '%@custodia.demo')::int as n`);
  if (ya!.n > 0) return false;
  const hashPwd = await bcrypt.hash(demoPassword(), 10);
  await tx(async c => {
    const rol = async (n: string) => (await one(c, 'select id_rol from roles where nombre=$1', [n]))!.id_rol as number;
    const users: [string, string, string, string, string, string][] = [
      ['USR-01', 'Andrea', 'Morales', 'supervisor', 'Supervisor', 'Supervisión de evidencia digital'],
      ['USR-02', 'Carlos', 'Pérez', 'recolector', 'Recolector', 'Recolección de campo'],
      ['USR-03', 'Luis', 'Herrera', 'custodio', 'Custodio', 'Resguardo digital'],
      ['USR-04', 'María', 'López', 'analista', 'Analista forense', 'Análisis digital'],
      ['USR-05', 'José', 'Ramírez', 'auditor', 'Auditor', 'Auditoría de trazabilidad'],
      ['USR-06', 'Daniela', 'Cruz', 'administrador', 'Administrador', 'Administración de plataforma'],
      ['USR-07', 'Sofía', 'Méndez', 'reportante', 'Reportante', 'Reporte de incidentes'],
    ];
    const uid: Record<string, number> = {};
    for (const [cod, n, a, k, r, unidad] of users) {
      uid[cod] = (await one(c, `insert into usuarios (codigo,id_rol,nombres,apellidos,correo,nombre_usuario,unidad,contrasena_hash,fecha_creacion)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id_usuario`, [cod, await rol(r), n, a, `${k}@custodia.demo`, k, unidad, hashPwd, at('2026-09-01')]))!.id_usuario;
    }
    const locs = [['LOC-001', 'Bodega digital A-03', 'fisica', 30], ['LOC-002', 'Repositorio seguro', 'logica', 100], ['LOC-003', 'Laboratorio forense B-01', 'fisica', 12],
      ['LOC-004', 'Laboratorio Forense B-02', 'fisica', 12], ['LOC-005', 'Bóveda Forense Nivel 2', 'fisica', 20]] as const;
    const lid: Record<string, number> = {};
    for (const [cod, n, t, cap] of locs) lid[cod] = (await one(c, 'insert into ubicaciones (codigo,nombre,tipo,capacidad) values ($1,$2,$3,$4) returning id_ubicacion', [cod, n, t, cap]))!.id_ubicacion;

    const casos: [string, string, string, string, string, string, string, string, string][] = [
      ['CAS-2026-001', 'Acceso no autorizado a servidor', 'Sesiones anómalas fuera de horario laboral y extracción no programada de respaldos. Escenario ficticio para la demostración.', 'Intrusión informática', 'Centro de datos · Zona 10, Ciudad de Guatemala', 'en_investigacion', 'USR-07', '2026-10-10', '08:30'],
      ['CAS-2026-002', 'Dispositivo USB encontrado', 'Memoria extraíble localizada en un equipo del área de contabilidad. Reporte pendiente de asignación de recolector.', 'Medio extraíble no identificado', 'Oficinas administrativas · Zona 9, Ciudad de Guatemala', 'abierto', 'USR-07', '2026-10-11', '11:15'],
      ['CAS-2026-003', 'Posible alteración de archivo', 'Discrepancia en el hash de una representación de imagen forense. Escenario ficticio para verificar el manejo de alertas.', 'Inconsistencia de integridad', 'Laboratorio Forense B-01 · Ciudad de Guatemala', 'en_investigacion', 'USR-02', '2026-10-12', '14:20'],
    ];
    const cid: Record<string, number> = {};
    for (const [cod, t, d, tipo, lugar, est, rep, f, h] of casos)
      cid[cod] = (await one(c, `insert into casos (codigo_caso,titulo,descripcion,tipo_incidente,lugar,estado,id_reportante,id_responsable,fecha_reporte) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id_caso`,
        [cod, t, d, tipo, lugar, est, uid[rep], uid['USR-01'], at(f, h)]))!.id_caso;
    await q(c, 'insert into caso_asignaciones (id_caso,id_usuario,fecha) values ($1,$2,$3),($4,$2,$3)', [cid['CAS-2026-001'], uid['USR-02'], at('2026-10-10', '09:00'), cid['CAS-2026-003']]);

    const tipoId = async (n: string) => (await one(c, 'select id_tipo from tipos_evidencia where nombre=$1', [n]))!.id_tipo as number;
    const defs = [
      ['014', '001', 'Disco SSD externo color negro', 'Dispositivo de almacenamiento', 'Samsung T7 Shield', 'S6XpNS0T802914K', '1 TB', 'LOC-001', '2026-10-10', '09:45', '11:20'],
      ['015', '001', 'Copia de registros del servidor', 'Registro de eventos (Logs)', 'Linux syslog', 'SRV-FIN-GT-02', '1.84 GB', 'LOC-002', '2026-10-10', '10:30', '11:35'],
      ['016', '003', 'Imagen forense del equipo investigado', 'Imagen forense', 'Dell OptiPlex 7090', 'DLL-GT-99201-X', '512 GB', 'LOC-003', '2026-10-12', '15:00', '16:00'],
    ];
    const eid: Record<string, number> = {};
    const eventos: { ev: string; caso: string; u: string; fecha: string; accion: string; detalle: string; loc: string; hash: string }[] = [];
    const hashes: Record<string, string> = {};
    for (const [i, d] of defs.entries()) {
      const [n, cn, desc, tipo, modelo, serie, cap, loc, fecha, hora, horaRec] = d;
      const codigo = `EVI-2026-${n}`, caso = `CAS-2026-${cn}`;
      const buf = Buffer.from(`CUSTODIA DIGITAL — ARCHIVO FICTICIO\n${codigo}\n${desc}\nNo contiene evidencia real. Representación académica de un contenedor digital.\n`, 'utf8');
      const hash = sha256(buf); hashes[codigo] = hash;
      const alterado = sha256('Contenido ficticio alterado ' + codigo);
      const integ = i === 2 ? 'no_coincide' : i === 1 ? 'verificada' : 'sin_verificar';
      const ev = (await one(c, `insert into evidencias (id_caso,codigo_unico,codigo_qr,id_tipo,nombre_referencia,descripcion,marca,modelo,numero_serie,capacidad_almacenamiento,estado_fisico,
          lugar_recoleccion,fecha_recoleccion,id_recolector,id_custodio_actual,id_ubicacion,estado,integridad,hash_inicial,hash_ultima_verificacion,observaciones,fecha_registro)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Sin daños visibles',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$12) returning *`,
        [cid[caso], codigo, 'QR-' + codigo, await tipoId(tipo), desc, desc, modelo.split(' ')[0], modelo, serie, cap, casos.find(x => x[0] === caso)![4], at(fecha, hora),
         uid['USR-02'], uid['USR-03'], lid[loc], i === 2 ? 'con_alerta' : 'en_custodia', integ, hash, i === 2 ? alterado : i === 1 ? hash : null,
         'Registro académico ficticio. Original lógico preservado; análisis solo sobre copia autorizada.']))!;
      eid[codigo] = ev.id_evidencia;
      await q(c, `insert into archivos_evidencia (codigo,id_evidencia,nombre_original,tipo_mime,extension,tamano_bytes,ruta_almacenamiento,hash_sha256,fecha_carga,id_usuario_carga,es_demo)
        values ($1,$2,$3,'text/plain','txt',$4,$5,$6,$7,$8,true)`, ['FIL-' + codigo, ev.id_evidencia, `representacion_${codigo}.txt`, buf.length, await guardar(c, buf, 'originales'), hash, at(fecha, hora), uid['USR-02']]);
      await q(c, `insert into registros_hash (id_evidencia,tipo_registro,valor_hash,modo,id_usuario,resultado,observaciones,fecha_calculo) values ($1,'inicial',$2,'inicial',$3,'no_aplica','Huella inicial calculada al registrar el original.',$4)`, [ev.id_evidencia, hash, uid['USR-02'], at(fecha, hora)]);
      const trf = (await one(c, `insert into transferencias_custodia (codigo,id_evidencia,id_entregante,id_receptor,id_autorizador,id_ubicacion_destino,fecha_solicitud,fecha_entrega,fecha_autorizacion,fecha_recepcion,motivo,estado,firma_entregante,firma_receptor)
        values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,'Ingreso a resguardo tras recolección.','recibida',$10,$11) returning id_transferencia`,
        [`TRF-2026-00${i + 1}`, ev.id_evidencia, uid['USR-02'], uid['USR-03'], uid['USR-01'], lid[loc], at(fecha, hora), at(fecha, '11:00'), at(fecha, horaRec),
         'FIRMA-SIM-' + sha256('e' + codigo).slice(0, 12).toUpperCase(), 'FIRMA-SIM-' + sha256('r' + codigo).slice(0, 12).toUpperCase()]))!;
      await q(c, `insert into registros_custodia (id_evidencia,id_custodio,id_ubicacion,ubicacion,fecha_inicio,fecha_fin,es_custodia_actual,observaciones) values ($1,$2,$3,$4,$5,$6,false,'Custodia inicial del recolector.')`,
        [ev.id_evidencia, uid['USR-02'], lid[loc], locs.find(l => l[0] === loc)![1], at(fecha, hora), at(fecha, horaRec)]);
      await q(c, `insert into registros_custodia (id_evidencia,id_custodio,id_ubicacion,ubicacion,id_transferencia,fecha_inicio,observaciones) values ($1,$2,$3,$4,$5,$6,'Recepción de Carlos Pérez.')`,
        [ev.id_evidencia, uid['USR-03'], lid[loc], locs.find(l => l[0] === loc)![1], trf.id_transferencia, at(fecha, horaRec)]);
      eventos.push({ ev: codigo, caso, u: 'USR-02', fecha: at(fecha, hora), accion: 'Registro y recolección', detalle: 'Registro del original lógico y huella digital de sus bytes ficticios.', loc, hash },
                   { ev: codigo, caso, u: 'USR-03', fecha: at(fecha, horaRec), accion: 'Recepción de custodia', detalle: 'Entrega de Carlos Pérez a Luis Herrera autorizada por Andrea Morales.', loc, hash });
    }

    // Verificaciones y alerta
    const e15 = eid['EVI-2026-015'], e16 = eid['EVI-2026-016'];
    await q(c, `insert into registros_hash (codigo,id_evidencia,tipo_registro,valor_hash,hash_esperado,modo,id_usuario,resultado,observaciones,fecha_calculo)
      values ('VER-2026-001',$1,'verificacion',$2,$2,'almacenado',$3,'coincide','Comprobación antes de emitir copia.',$4)`, [e15, hashes['EVI-2026-015'], uid['USR-03'], at('2026-10-11', '08:50')]);
    const alt = sha256('Contenido ficticio alterado EVI-2026-016');
    const v2 = (await one(c, `insert into registros_hash (codigo,id_evidencia,tipo_registro,valor_hash,hash_esperado,modo,id_usuario,resultado,observaciones,fecha_calculo)
      values ('VER-2026-002',$1,'verificacion',$2,$3,'simulacion',$4,'no_coincide','Ejemplo de discrepancia para revisar trazabilidad.',$5) returning id_registro_hash`,
      [e16, alt, hashes['EVI-2026-016'], uid['USR-03'], at('2026-10-13', '16:10')]))!;
    const al = (await one(c, `insert into alertas_integridad (codigo,id_evidencia,id_registro_hash,nivel,descripcion,hash_esperado,hash_observado,fecha_generacion)
      values ('ALT-2026-001',$1,$2,'critica','El hash verificado (VER-2026-002) no coincide con el hash inicial de EVI-2026-016.',$3,$4,$5) returning id_alerta`,
      [e16, v2.id_registro_hash, hashes['EVI-2026-016'], alt, at('2026-10-13', '16:10')]))!;
    await q(c, `insert into alertas_historial (id_alerta,id_usuario,accion,notas,fecha) values ($1,$2,'Alerta generada','Generada por la verificación VER-2026-002.',$3)`, [al.id_alerta, uid['USR-03'], at('2026-10-13', '16:10')]);
    eventos.push({ ev: 'EVI-2026-016', caso: 'CAS-2026-003', u: 'USR-03', fecha: at('2026-10-13', '16:10'), accion: 'Discrepancia de integridad', detalle: 'Alerta ALT-2026-001 registrada. El hash inicial permanece intacto.', loc: 'LOC-003', hash: alt });

    // Solicitudes, copia y análisis
    const s1 = (await one(c, `insert into solicitudes_acceso (codigo,id_evidencia,id_solicitante,id_supervisor,alcance,fecha_solicitud,fecha_respuesta,motivo,estado,fecha_vencimiento,observaciones_supervisor)
      values ('SOL-2026-001',$1,$2,$3,'copia_trabajo',$4,$5,'Correlación de eventos de autenticación sobre copia de trabajo.','aprobada',hoy_gt()+14,'Acceso a copia de trabajo autorizado.') returning id_solicitud`,
      [e15, uid['USR-04'], uid['USR-01'], at('2026-10-11', '09:00'), at('2026-10-11', '09:15')]))!;
    await q(c, `insert into solicitudes_acceso (codigo,id_evidencia,id_solicitante,alcance,fecha_solicitud,motivo,estado,fecha_vencimiento)
      values ('SOL-2026-002',$1,$2,'copia_trabajo',$3,'Inspección de estructura de archivos de la representación del dispositivo.','pendiente',hoy_gt()+10)`, [eid['EVI-2026-014'], uid['USR-04'], at('2026-10-13', '10:20')]);
    const cp = (await one(c, `insert into copias_autorizadas (codigo,id_evidencia,id_solicitud,id_propietario,hash_sha256,fecha_creacion) values ('COPY-EVI-2026-015-001',$1,$2,$3,$4,$5) returning id_copia`,
      [e15, s1.id_solicitud, uid['USR-04'], hashes['EVI-2026-015'], at('2026-10-11', '09:15')]))!;
    const orig = (await one(c, 'select * from archivos_evidencia where id_evidencia=$1', [e15]))!;
    const { leer } = await import('./storage');
    await q(c, `insert into archivos_evidencia (codigo,id_evidencia,id_copia,nombre_original,tipo_mime,extension,tamano_bytes,ruta_almacenamiento,hash_sha256,fecha_carga,id_usuario_carga,es_archivo_original,es_demo)
      values ('COPY-FIL-015',$1,$2,$3,'text/plain','txt',$4,$5,$6,$7,$8,false,true)`,
      [e15, cp.id_copia, 'copia_autorizada_' + orig.nombre_original, orig.tamano_bytes, await guardar(c, await leer(c, orig.ruta_almacenamiento), 'copias'), orig.hash_sha256, at('2026-10-11', '09:15'), uid['USR-01']]);
    await q(c, `insert into analisis_forenses (codigo,id_evidencia,id_solicitud,id_copia,id_analista,proposito,actividad_realizada,herramientas,resultado,conclusiones,fecha_inicio,fecha_fin,fecha_registro)
      values ('ANA-2026-001',$1,$2,$3,$4,'Identificar accesos fuera del horario habitual.','Filtrado cronológico de registros en la copia autorizada.','Lectura de registros y búsqueda cronológica',
      'Escenario ficticio: se identificaron intentos fallidos y un acceso fuera de horario.','Revisar las cuentas involucradas; conclusión académica sin valor pericial.','2026-10-11','2026-10-12',$5)`,
      [e15, s1.id_solicitud, cp.id_copia, uid['USR-04'], at('2026-10-12', '17:30')]);
    eventos.push({ ev: 'EVI-2026-015', caso: 'CAS-2026-001', u: 'USR-01', fecha: at('2026-10-11', '09:15'), accion: 'Copia autorizada emitida', detalle: 'SOL-2026-001 aprobada; COPY-EVI-2026-015-001 para María López. El original no se entrega.', loc: 'LOC-002', hash: hashes['EVI-2026-015'] });
    eventos.push({ ev: 'EVI-2026-015', caso: 'CAS-2026-001', u: 'USR-04', fecha: at('2026-10-12', '17:30'), accion: 'Análisis forense registrado', detalle: 'ANA-2026-001 sobre copia autorizada. Solo hallazgos; el original no se tocó.', loc: 'LOC-002', hash: hashes['EVI-2026-015'] });

    // Línea de tiempo y bitácora (cronológica para que la cadena de hashes respete el orden)
    eventos.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const uinfo = (cod: string) => { const x = users.find(u => u[0] === cod)!; return { nombre: `${x[1]} ${x[2]}`, rol: x[4] }; };
    for (const e of eventos) {
      const ui = uinfo(e.u);
      await q(c, `insert into eventos_custodia (id_evidencia,id_caso,id_usuario,nombre_usuario_hist,rol_hist,accion,detalle,id_ubicacion,hash_referencia,fecha) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [eid[e.ev], cid[e.caso], uid[e.u], ui.nombre, ui.rol, e.accion, e.detalle, lid[e.loc], e.hash, e.fecha]);
      await q(c, `insert into bitacora_auditoria (id_usuario,nombre_hist,rol_hist,id_caso,id_evidencia,modulo,accion,referencia,descripcion,resultado,fecha_hora)
        values ($1,$2,$3,$4,$5,'Custodia',$6,$7,$8,$9,$10)`,
        [uid[e.u], ui.nombre, ui.rol, cid[e.caso], eid[e.ev], e.accion, e.ev, e.detalle, e.accion.startsWith('Discrepancia') ? 'critico' : 'exitoso', e.fecha]);
    }

    // Contadores: el próximo código continúa tras los datos de demostración.
    for (const [p, v] of [['CAS', 3], ['EVI', 16], ['TRF', 3], ['SOL', 2], ['ANA', 1], ['VER', 2], ['ALT', 1]] as const)
      await q(c, `insert into contadores (prefijo,anio,valor) values ($1,2026,$2) on conflict (prefijo,anio) do update set valor=greatest(contadores.valor,$2)`, [p, v]);
    await q(c, `update configuracion set valor='' where clave='ultimo_respaldo'`);
  });
  return true;
}

if (require.main === module) {
  migrate().then(() => seed()).then(done => { console.log(done ? 'Datos de demostración cargados.' : 'La base ya tiene datos; no se modificó.'); return pool.end(); })
    .catch(e => { console.error(e); process.exit(1); });
}
