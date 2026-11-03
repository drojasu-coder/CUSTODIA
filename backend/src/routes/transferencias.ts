import { Router } from 'express';
import { z } from 'zod';
import { audit, evento } from '../audit';
import { casoAbierto, codigoNuevo, evidenciaVisible } from '../access';
import { requirePermission } from '../auth';
import { one, pool, q, tx } from '../db';
import { bad, conflict, forbidden, notFound, wrap , idParam } from '../errors';
import { pageParams, sha256 } from '../util';

export const transferenciasRouter = Router();
const firma = (nombre: string, codigo: string) => `FIRMA-SIM-${sha256(nombre + codigo + Date.now()).slice(0, 12).toUpperCase()}`;

const SEL = `select t.*, ev.codigo_unico, ev.nombre_referencia, ev.id_caso, ca.codigo_caso,
    en.nombres||' '||en.apellidos as entregante, re.nombres||' '||re.apellidos as receptor, ub.nombre as ubicacion_destino,
    au.nombres||' '||au.apellidos as autorizador
  from transferencias_custodia t join evidencias ev using(id_evidencia) join casos ca using(id_caso)
  join usuarios en on en.id_usuario=t.id_entregante join usuarios re on re.id_usuario=t.id_receptor
  join ubicaciones ub on ub.id_ubicacion=t.id_ubicacion_destino left join usuarios au on au.id_usuario=t.id_autorizador`;

async function cargar(c: any, id: number, user: { id: number; rol: string }, bloquear = false) {
  // Al modificar, se bloquea la fila: dos autorizaciones/recepciones simultáneas no pueden pasar ambas.
  const t = await one(c, `${SEL} where t.id_transferencia=$1${bloquear ? ' for update of t' : ''}`, [id]);
  if (!t) throw notFound('Transferencia no encontrada.');
  const full = ['Supervisor', 'Auditor'].includes(user.rol);
  if (!full && t.id_entregante !== user.id && t.id_receptor !== user.id) throw forbidden('No participa en esta transferencia.');
  return t;
}

transferenciasRouter.get('/', requirePermission('consultar_transferencias'), wrap(async (req, res) => {
  const u = req.user!, { page, size, offset } = pageParams(req.query);
  const full = ['Supervisor', 'Auditor'].includes(u.rol);
  const estado = typeof req.query.estado === 'string' && req.query.estado ? req.query.estado : null;
  const p = [full, u.id, estado];
  const w = `($1::boolean or t.id_entregante=$2 or t.id_receptor=$2) and ($3::text is null or t.estado::text=$3)`;
  const total = (await one(pool, `select count(*)::int n from transferencias_custodia t where ${w}`, p))!.n;
  const items = await q(pool, `${SEL} where ${w} order by t.id_transferencia desc limit $4 offset $5`, [...p, size, offset]);
  res.json({ total, page, size, items });
}));

transferenciasRouter.get('/receptores', requirePermission('transferir_custodia'), wrap(async (req, res) => {
  res.json(await q(pool, `select u.id_usuario, u.nombres||' '||u.apellidos as nombre from usuarios u join roles r using(id_rol)
      where r.nombre='Custodio' and u.activo and u.id_usuario<>$1 order by 2`, [req.user!.id]));
}));

transferenciasRouter.post('/', requirePermission('transferir_custodia'), wrap(async (req, res) => {
  const u = req.user!;
  const b = z.object({
    id_evidencia: z.number().int(), id_receptor: z.number().int(), id_ubicacion_destino: z.number().int(),
    motivo: z.string().trim().min(5, 'Indique el motivo (mínimo 5 caracteres).').max(250),
    confirmo_firma: z.literal(true, { errorMap: () => ({ message: 'Debe confirmar la entrega con su firma simulada.' }) }),
  }).parse(req.body);
  const t = await tx(async c => {
    const ev = await evidenciaVisible(u, b.id_evidencia, c);
    await q(c, 'select 1 from evidencias where id_evidencia=$1 for update', [b.id_evidencia]);
    if (ev.id_custodio_actual !== u.id) throw forbidden('Solo el responsable actual puede entregar la evidencia.');
    casoAbierto({ estado: ev.estado_caso });
    if (b.id_receptor === u.id) throw bad('El receptor debe ser distinto de quien entrega.');
    const rec = await one(c, `select 1 from usuarios us join roles r using(id_rol) where us.id_usuario=$1 and r.nombre='Custodio' and us.activo`, [b.id_receptor]);
    if (!rec) throw bad('El receptor debe ser un Custodio activo.');
    const ub = await one(c, 'select 1 from ubicaciones where id_ubicacion=$1 and activo', [b.id_ubicacion_destino]);
    if (!ub) throw bad('Ubicación de destino inválida o inactiva.');
    const activa = await one(c, `select codigo, estado from transferencias_custodia where id_evidencia=$1 and estado in ('pendiente','autorizada')`, [b.id_evidencia]);
    if (activa) throw conflict(`La evidencia ya tiene la transferencia ${activa.codigo} en estado ${activa.estado}: concluya o cancele esa entrega primero.`);
    if (['con_alerta', 'archivada'].includes(ev.estado) || ['no_coincide', 'en_revision'].includes(ev.integridad))
      throw conflict('La evidencia tiene una discrepancia de integridad sin resolver o está archivada: no puede transferirse.');
    const codigo = await codigoNuevo(c, 'TRF');
    const t = await one(c, `insert into transferencias_custodia (codigo,id_evidencia,id_entregante,id_receptor,id_ubicacion_destino,motivo,firma_entregante)
      values ($1,$2,$3,$4,$5,$6,$7) returning *`, [codigo, b.id_evidencia, u.id, b.id_receptor, b.id_ubicacion_destino, b.motivo, firma(u.nombre, codigo)]);
    await q(c, `update evidencias set estado='transferida' where id_evidencia=$1`, [b.id_evidencia]);
    await evento(c, u, ev, 'Entrega de custodia', `Transferencia ${codigo} pendiente de autorización del Supervisor.`);
    await audit(c, u, req, { modulo: 'Custodia', accion: 'Entrega de custodia', referencia: codigo, id_caso: ev.id_caso, id_evidencia: b.id_evidencia, descripcion: b.motivo });
    return t;
  });
  res.status(201).json(t);
}));

transferenciasRouter.post('/:id/autorizar', requirePermission('autorizar_transferencia'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const b = z.object({ observaciones: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  await tx(async c => {
    const t = await cargar(c, id, u, true);
    if (t.estado !== 'pendiente') throw conflict('La transferencia ya no está pendiente de autorización.');
    if ([t.id_entregante, t.id_receptor].includes(u.id)) throw forbidden('No puede autorizar una transferencia en la que participa.');
    const evAct = await one(c, 'select integridad from evidencias where id_evidencia=$1', [t.id_evidencia]);
    if (['no_coincide', 'en_revision'].includes(evAct.integridad)) throw conflict('La evidencia tiene una discrepancia de integridad sin resolver: no se autoriza su transferencia.');
    await q(c, `update transferencias_custodia set estado='autorizada', id_autorizador=$2, fecha_autorizacion=now(), observaciones=$3 where id_transferencia=$1`, [id, u.id, b.observaciones ?? null]);
    const ev = await one(c, 'select * from evidencias where id_evidencia=$1', [t.id_evidencia]);
    await evento(c, u, ev, 'Autorización de transferencia', `Transferencia ${t.codigo} autorizada; pendiente de recepción por ${t.receptor}.`);
    await audit(c, u, req, { modulo: 'Custodia', accion: 'Autorización de transferencia', referencia: t.codigo, id_caso: t.id_caso, id_evidencia: t.id_evidencia });
  });
  res.json({ ok: true });
}));

transferenciasRouter.post('/:id/rechazar', requirePermission('autorizar_transferencia'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const b = z.object({ observaciones: z.string().trim().min(5, 'Indique el motivo del rechazo.').max(500) }).parse(req.body);
  await tx(async c => {
    const t = await cargar(c, id, u, true);
    if (t.estado !== 'pendiente') throw conflict('La transferencia ya no está pendiente de autorización.');
    if ([t.id_entregante, t.id_receptor].includes(u.id)) throw forbidden('No puede resolver una transferencia en la que participa.');
    await q(c, `update transferencias_custodia set estado='rechazada', id_autorizador=$2, fecha_autorizacion=now(), observaciones=$3 where id_transferencia=$1`, [id, u.id, b.observaciones]);
    await q(c, `update evidencias set estado='en_custodia' where id_evidencia=$1 and estado='transferida'`, [t.id_evidencia]);
    const ev = await one(c, 'select * from evidencias where id_evidencia=$1', [t.id_evidencia]);
    await evento(c, u, ev, 'Transferencia rechazada', `Transferencia ${t.codigo} rechazada: ${b.observaciones}`);
    await audit(c, u, req, { modulo: 'Custodia', accion: 'Rechazo de transferencia', referencia: t.codigo, id_caso: t.id_caso, id_evidencia: t.id_evidencia, descripcion: b.observaciones, resultado: 'rechazado' });
  });
  res.json({ ok: true });
}));

transferenciasRouter.post('/:id/cancelar', requirePermission('transferir_custodia'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  await tx(async c => {
    const t = await cargar(c, id, u, true);
    if (t.id_entregante !== u.id) throw forbidden('Solo quien entrega puede cancelar la transferencia.');
    if (!['pendiente', 'autorizada'].includes(t.estado)) throw conflict('La transferencia ya concluyó.');
    await q(c, `update transferencias_custodia set estado='cancelada' where id_transferencia=$1`, [id]);
    await q(c, `update evidencias set estado='en_custodia' where id_evidencia=$1 and estado='transferida'`, [t.id_evidencia]);
    const ev = await one(c, 'select * from evidencias where id_evidencia=$1', [t.id_evidencia]);
    await evento(c, u, ev, 'Transferencia cancelada', `Transferencia ${t.codigo} cancelada por quien entrega.`);
    await audit(c, u, req, { modulo: 'Custodia', accion: 'Cancelación de transferencia', referencia: t.codigo, id_caso: t.id_caso, id_evidencia: t.id_evidencia });
  });
  res.json({ ok: true });
}));

transferenciasRouter.post('/:id/recibir', requirePermission('recibir_custodia'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  z.object({ confirmo_firma: z.literal(true, { errorMap: () => ({ message: 'Debe confirmar la recepción con su firma simulada.' }) }) }).parse(req.body);
  await tx(async c => {
    const t = await cargar(c, id, u, true);
    if (t.id_receptor !== u.id) throw forbidden('Solo el receptor asignado puede confirmar la recepción.');
    if (t.estado !== 'autorizada') throw conflict(t.estado === 'pendiente' ? 'La transferencia aún no fue autorizada por el Supervisor.' : 'La transferencia ya concluyó.');
    const evAct = await one(c, 'select id_custodio_actual, estado, integridad from evidencias where id_evidencia=$1 for update', [t.id_evidencia]);
    if (evAct.id_custodio_actual !== t.id_entregante) throw conflict('La evidencia ya no está a cargo de quien la entregó: la transferencia no es consistente.');
    if (['no_coincide', 'en_revision'].includes(evAct.integridad)) throw conflict('La evidencia tiene una discrepancia de integridad sin resolver: no puede recibirse hasta que se resuelva.');
    const ub = await one(c, `select u.*, (select count(*)::int from evidencias e where e.id_ubicacion=u.id_ubicacion and e.estado<>'archivada') as ocupados
      from ubicaciones u where id_ubicacion=$1 and activo for update`, [t.id_ubicacion_destino]);
    if (!ub) throw conflict('La ubicación de destino ya no está activa.');
    if (ub.ocupados >= ub.capacidad) throw conflict(`La ubicación "${ub.nombre}" alcanzó su capacidad.`);
    await q(c, `update registros_custodia set es_custodia_actual=false, fecha_fin=now() where id_evidencia=$1 and es_custodia_actual`, [t.id_evidencia]);
    await q(c, `insert into registros_custodia (id_evidencia,id_custodio,id_ubicacion,ubicacion,id_transferencia,observaciones) values ($1,$2,$3,$4,$5,$6)`,
      [t.id_evidencia, u.id, ub.id_ubicacion, ub.nombre, id, `Recepción de ${t.entregante}.`]);
    await q(c, `update evidencias set id_custodio_actual=$2, id_ubicacion=$3, estado='en_custodia' where id_evidencia=$1`, [t.id_evidencia, u.id, ub.id_ubicacion]);
    await q(c, `update transferencias_custodia set estado='recibida', fecha_recepcion=now(), firma_receptor=$2 where id_transferencia=$1`, [id, firma(u.nombre, t.codigo)]);
    const ev = await one(c, 'select * from evidencias where id_evidencia=$1', [t.id_evidencia]);
    await evento(c, u, ev, 'Recepción de custodia', `Entrega de ${t.entregante} a ${u.nombre} (${t.codigo}).`);
    await audit(c, u, req, { modulo: 'Custodia', accion: 'Recepción de custodia', referencia: t.codigo, id_caso: t.id_caso, id_evidencia: t.id_evidencia });
  });
  res.json({ ok: true });
}));

transferenciasRouter.get('/:id', requirePermission('consultar_transferencias'), wrap(async (req, res) => {
  res.json(await cargar(pool, idParam(req), req.user!));
}));
