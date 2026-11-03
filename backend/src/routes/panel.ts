import { Router } from 'express';
import { pool, q, one } from '../db';
import { wrap } from '../errors';
import { expirarSolicitudes } from '../access';

export const panelRouter = Router();

panelRouter.get('/', wrap(async (req, res) => {
  const u = req.user!;
  await expirarSolicitudes();
  const p = [u.id, u.rol];
  const n = async (sql: string, extra: unknown[] = []) => (await one(pool, sql, [...p, ...extra]))!.n as number;
  const out: Record<string, unknown> = {
    casos: await n(`select count(*)::int n from casos c where puede_ver_caso($1,$2,c.id_caso)`),
    casos_abiertos: await n(`select count(*)::int n from casos c where puede_ver_caso($1,$2,c.id_caso) and c.estado in ('abierto','en_investigacion','suspendido')`),
    evidencias: await n(`select count(*)::int n from evidencias e where puede_ver_evidencia($1,$2,e.id_evidencia)`),
    alertas_abiertas: await n(`select count(*)::int n from alertas_integridad a where puede_ver_evidencia($1,$2,a.id_evidencia) and a.estado in ('pendiente','en_revision')`),
    transferencias_pendientes: await n(`select count(*)::int n from transferencias_custodia t where $2::text is not null and t.estado in ('pendiente','autorizada') and ($3::boolean or t.id_entregante=$1 or t.id_receptor=$1)`, [['Supervisor', 'Auditor'].includes(u.rol)]),
    solicitudes_pendientes: await n(`select count(*)::int n from solicitudes_acceso s where $2::text is not null and s.estado='pendiente' and ($3::boolean or s.id_solicitante=$1)`, [['Supervisor', 'Auditor'].includes(u.rol)]),
  };
  // Tareas accionables por rol
  const tareas: { tipo: string; texto: string; ref: string; id: number }[] = [];
  if (u.rol === 'Supervisor') {
    for (const t of await q(pool, `select id_transferencia id, codigo from transferencias_custodia where estado='pendiente' order by id_transferencia`)) tareas.push({ tipo: 'transferencia', texto: 'Transferencia por autorizar', ref: t.codigo, id: t.id });
    for (const s of await q(pool, `select id_solicitud id, codigo from solicitudes_acceso where estado='pendiente' order by id_solicitud`)) tareas.push({ tipo: 'solicitud', texto: 'Solicitud de acceso por resolver', ref: s.codigo, id: s.id });
    for (const a of await q(pool, `select id_alerta id, codigo from alertas_integridad where estado='pendiente' order by id_alerta`)) tareas.push({ tipo: 'alerta', texto: 'Alerta de integridad sin revisar', ref: a.codigo, id: a.id });
  }
  if (u.rol === 'Analista forense') {
    for (const s of await q(pool, `select s.id_solicitud id, s.codigo from solicitudes_acceso s where s.id_solicitante=$1 and s.estado='aprobada'
        and s.fecha_vencimiento>=hoy_gt() and not exists (select 1 from analisis_forenses a where a.id_solicitud=s.id_solicitud) order by s.id_solicitud`, [u.id]))
      tareas.push({ tipo: 'solicitud', texto: 'Copia autorizada pendiente de análisis', ref: s.codigo, id: s.id });
  }
  if (u.rol === 'Custodio') {
    for (const t of await q(pool, `select id_transferencia id, codigo from transferencias_custodia where estado='autorizada' and id_receptor=$1`, [u.id])) tareas.push({ tipo: 'transferencia', texto: 'Recepción pendiente de confirmar', ref: t.codigo, id: t.id });
  }
  const recientes = await q(pool, `select b.codigo, b.accion, b.referencia, b.fecha_hora, b.nombre_hist as usuario from bitacora_auditoria b
    where (b.id_usuario=$1 or $2::boolean) order by b.id_bitacora desc limit 6`, [u.id, ['Supervisor', 'Auditor'].includes(u.rol)]);
  res.json({ ...out, tareas, recientes });
}));
