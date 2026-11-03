import { Router } from 'express';
import { audit } from '../audit';
import { hasPerm, requirePermission } from '../auth';
import { pool, q } from '../db';
import { bad, forbidden, wrap } from '../errors';
import { toCsv } from '../util';
import { filtroAuditoria } from './auditoria';

export const reportesRouter = Router();

type Def = { titulo: string; admin?: boolean; cols: Record<string, string>; sql: (f: any) => { text: string; params: unknown[] } };
const rango = (col: string, n: number) => `($${n}::date is null or ${col} >= $${n}::date) and ($${n + 1}::date is null or ${col} < $${n + 1}::date + 1)`;

const DEFS: Record<string, Def> = {
  cadena: {
    titulo: 'Cadena de custodia', cols: { fecha: 'Fecha', evidencia: 'Evidencia', caso: 'Caso', accion: 'Acción', usuario: 'Usuario', rol: 'Rol', ubicacion: 'Ubicación', hash: 'Hash de referencia', detalle: 'Detalle' },
    sql: f => ({ text: `select ev.fecha, e.codigo_unico as evidencia, c.codigo_caso as caso, ev.accion, ev.nombre_usuario_hist as usuario, ev.rol_hist as rol, ub.nombre as ubicacion, ev.hash_referencia as hash, ev.detalle
        from eventos_custodia ev join evidencias e using(id_evidencia) join casos c on c.id_caso=ev.id_caso left join ubicaciones ub on ub.id_ubicacion=ev.id_ubicacion
        where ($1::int is null or ev.id_caso=$1) and ($2::int is null or ev.id_evidencia=$2) and ${rango('ev.fecha', 3)} order by ev.fecha, ev.id_evento`, params: [f.id_caso, f.id_evidencia, f.desde, f.hasta] }),
  },
  integridad: {
    titulo: 'Verificaciones y alertas de integridad', cols: { fecha: 'Fecha', codigo: 'Verificación', evidencia: 'Evidencia', usuario: 'Verificó', modo: 'Modo', resultado: 'Resultado', esperado: 'Hash esperado', obtenido: 'Hash obtenido', alerta: 'Alerta', estado_alerta: 'Estado de alerta' },
    sql: f => ({ text: `select r.fecha_calculo as fecha, r.codigo, e.codigo_unico as evidencia, vu.nombres||' '||vu.apellidos as usuario, r.modo, r.resultado, r.hash_esperado as esperado, r.valor_hash as obtenido, a.codigo as alerta, a.estado as estado_alerta
        from registros_hash r join evidencias e using(id_evidencia) join usuarios vu on vu.id_usuario=r.id_usuario left join alertas_integridad a on a.id_registro_hash=r.id_registro_hash
        where r.tipo_registro='verificacion' and ($1::int is null or e.id_caso=$1) and ($2::int is null or e.id_evidencia=$2) and ${rango('r.fecha_calculo', 3)} order by r.id_registro_hash`, params: [f.id_caso, f.id_evidencia, f.desde, f.hasta] }),
  },
  transferencias: {
    titulo: 'Transferencias de custodia', cols: { codigo: 'Código', evidencia: 'Evidencia', entregante: 'Entrega', receptor: 'Recibe', autorizador: 'Autoriza', estado: 'Estado', fecha: 'Fecha de entrega', autorizacion: 'Fecha de autorización', recepcion: 'Fecha de recepción', destino: 'Ubicación destino', firmas: 'Firmas simuladas', motivo: 'Motivo' },
    sql: f => ({ text: `select t.codigo, e.codigo_unico as evidencia, en.nombres||' '||en.apellidos as entregante, re.nombres||' '||re.apellidos as receptor, au.nombres||' '||au.apellidos as autorizador,
        t.estado, t.fecha_entrega as fecha, t.fecha_autorizacion as autorizacion, t.fecha_recepcion as recepcion, ud.nombre as destino,
        concat_ws(' / ', t.firma_entregante, t.firma_receptor) as firmas, t.motivo
        from transferencias_custodia t join evidencias e using(id_evidencia) join ubicaciones ud on ud.id_ubicacion=t.id_ubicacion_destino join usuarios en on en.id_usuario=t.id_entregante join usuarios re on re.id_usuario=t.id_receptor left join usuarios au on au.id_usuario=t.id_autorizador
        where ($1::int is null or e.id_caso=$1) and ($2::int is null or e.id_evidencia=$2) and ${rango('t.fecha_entrega', 3)} order by t.id_transferencia`, params: [f.id_caso, f.id_evidencia, f.desde, f.hasta] }),
  },
  solicitudes: {
    titulo: 'Solicitudes de acceso y análisis', cols: { codigo: 'Solicitud', evidencia: 'Evidencia', solicitante: 'Solicitante', estado: 'Estado', fecha: 'Fecha', vence: 'Vence', supervisor: 'Resolvió', respuesta: 'Fecha de respuesta', copia: 'Copia autorizada', analisis: 'Análisis' },
    sql: f => ({ text: `select s.codigo, e.codigo_unico as evidencia, so.nombres||' '||so.apellidos as solicitante, s.estado, s.fecha_solicitud as fecha, s.fecha_vencimiento as vence,
        sp.nombres||' '||sp.apellidos as supervisor, s.fecha_respuesta as respuesta, cp.codigo as copia, an.codigo as analisis
        from solicitudes_acceso s join evidencias e using(id_evidencia) left join copias_autorizadas cp on cp.id_solicitud=s.id_solicitud join usuarios so on so.id_usuario=s.id_solicitante left join usuarios sp on sp.id_usuario=s.id_supervisor left join analisis_forenses an on an.id_solicitud=s.id_solicitud
        where ($1::int is null or e.id_caso=$1) and ($2::int is null or e.id_evidencia=$2) and ${rango('s.fecha_solicitud', 3)} order by s.id_solicitud`, params: [f.id_caso, f.id_evidencia, f.desde, f.hasta] }),
  },
  usuarios: {
    titulo: 'Usuarios y roles', admin: true, cols: { codigo: 'Código', nombre: 'Nombre', correo: 'Correo', rol: 'Rol', unidad: 'Unidad', activo: 'Activo', creado: 'Creación', ultimo_acceso: 'Último acceso' },
    sql: f => ({ text: `select u.codigo, u.nombres||' '||u.apellidos as nombre, u.correo, r.nombre as rol, u.unidad, case when u.activo then 'Sí' else 'No' end as activo, u.fecha_creacion as creado, u.ultimo_acceso
        from usuarios u join roles r using(id_rol) where ${rango('u.fecha_creacion', 1)} order by u.codigo`, params: [f.desde, f.hasta] }),
  },
  permisos: {
    titulo: 'Matriz de roles y permisos', admin: true, cols: { rol: 'Rol', permiso: 'Permiso', condicion: 'Condición adicional' },
    sql: () => ({ text: `select r.nombre as rol, p.nombre as permiso, p.descripcion as condicion from rol_permiso rp join roles r using(id_rol) join permisos p using(id_permiso) order by r.id_rol, p.id_permiso`, params: [] }),
  },
  catalogos: {
    titulo: 'Catálogos y ubicaciones', admin: true, cols: { codigo: 'Código', nombre: 'Nombre', tipo: 'Tipo', capacidad: 'Capacidad', ocupacion: 'Ocupación', activo: 'Activo' },
    sql: () => ({ text: `select ub.codigo, ub.nombre, ub.tipo, ub.capacidad, (select count(*)::int from evidencias e where e.id_ubicacion=ub.id_ubicacion and e.estado<>'archivada') as ocupacion, case when ub.activo then 'Sí' else 'No' end as activo from ubicaciones ub order by ub.codigo`, params: [] }),
  },
  actividad_tecnica: {
    titulo: 'Actividad técnica y de seguridad', admin: true, cols: { fecha: 'Fecha', usuario: 'Usuario', modulo: 'Módulo', accion: 'Acción', resultado: 'Resultado', ip: 'IP' },
    sql: f => ({ text: `select b.fecha_hora as fecha, b.nombre_hist as usuario, b.modulo, b.accion, b.resultado, b.direccion_ip as ip from bitacora_auditoria b
        where b.modulo in ('Administración','Autenticación','Seguridad','Catálogos') and ${rango('b.fecha_hora', 1)} order by b.id_bitacora desc limit 2000`, params: [f.desde, f.hasta] }),
  },
  auditoria: {
    titulo: 'Bitácora de auditoría', cols: { fecha: 'Fecha', usuario: 'Usuario', rol: 'Rol', modulo: 'Módulo', accion: 'Acción', referencia: 'Referencia', resultado: 'Resultado' },
    sql: f => ({ text: `select b.fecha_hora as fecha, b.nombre_hist as usuario, b.rol_hist as rol, b.modulo, b.accion, b.referencia, b.resultado from bitacora_auditoria b
        where ${rango('b.fecha_hora', 1)} order by b.id_bitacora desc limit 5000`, params: [f.desde, f.hasta] }),
  },
};

reportesRouter.get('/:tipo', requirePermission('generar_reportes', 'generar_reportes_admin'), wrap(async (req, res) => {
  const u = req.user!, def = DEFS[req.params.tipo];
  if (!def) throw bad('Tipo de reporte desconocido.');
  if (def.admin ? !hasPerm(u, 'generar_reportes_admin') : !hasPerm(u, 'generar_reportes')) throw forbidden('Su rol no puede generar este reporte.');
  const nul = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : null);
  const num = (k: string) => (nul(k) ? Number(nul(k)) : null);
  const f = { id_caso: num('id_caso'), id_evidencia: num('id_evidencia'), desde: nul('desde'), hasta: nul('hasta') };
  if ([f.id_caso, f.id_evidencia].some(v => v !== null && !Number.isInteger(v))) throw bad('Filtro inválido.');
  const { text, params } = def.sql(f);
  const filas = await q(pool, text, params);
  await audit(pool, u, req, { modulo: 'Reportes', accion: 'Generación de reporte', referencia: req.params.tipo, descripcion: `${filas.length} filas` });
  if (req.query.format === 'csv') {
    const etiquetado = filas.map(r => Object.fromEntries(Object.entries(def.cols).map(([k, l]) => [l, r[k]])));
    return res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="reporte_${req.params.tipo}.csv"` })
      .send(etiquetado.length ? toCsv(etiquetado) : toCsv([Object.fromEntries(Object.values(def.cols).map(l => [l, '']))]).split('\r\n')[0]);
  }
  res.json({ tipo: req.params.tipo, titulo: def.titulo, generado: new Date().toISOString(), generado_por: u.nombre,
    columnas: Object.entries(def.cols).map(([k, label]) => ({ k, label })), filas });
}));
void filtroAuditoria;
