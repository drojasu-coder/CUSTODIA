import { Router } from 'express';
import { z } from 'zod';
import { audit, evento } from '../audit';
import { requirePermission } from '../auth';
import { one, pool, q, tx } from '../db';
import { conflict, forbidden, notFound, wrap , idParam } from '../errors';
import { pageParams } from '../util';

export const alertasRouter = Router();
const SEL = `select a.*, e.codigo_unico, e.nombre_referencia, e.id_caso, c.codigo_caso,
    sr.nombres||' '||sr.apellidos as supervisor from alertas_integridad a join evidencias e using(id_evidencia) join casos c using(id_caso)
    left join usuarios sr on sr.id_usuario=a.id_supervisor_revisor`;

alertasRouter.get('/', requirePermission('consultar_alertas'), wrap(async (req, res) => {
  const u = req.user!, { page, size, offset } = pageParams(req.query);
  const estado = typeof req.query.estado === 'string' && req.query.estado ? req.query.estado : null;
  const p = [u.id, u.rol, estado], w = `puede_ver_evidencia($1,$2,a.id_evidencia) and ($3::text is null or a.estado::text=$3)`;
  const total = (await one(pool, `select count(*)::int n from alertas_integridad a where ${w}`, p))!.n;
  const items = await q(pool, `${SEL} where ${w} order by a.id_alerta desc limit $4 offset $5`, [...p, size, offset]);
  res.json({ total, page, size, items });
}));

alertasRouter.get('/:id', requirePermission('consultar_alertas'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const a = await one(pool, `${SEL} where a.id_alerta=$1`, [id]);
  if (!a) throw notFound('Alerta no encontrada.');
  if (!(await one(pool, 'select puede_ver_evidencia($1,$2,$3) ok', [u.id, u.rol, a.id_evidencia]))!.ok) throw forbidden('No tiene acceso a esta alerta.');
  const historial = await q(pool, `select h.*, us.nombres||' '||us.apellidos as usuario from alertas_historial h join usuarios us using(id_usuario) where id_alerta=$1 order by id_historial`, [id]);
  res.json({ ...a, historial });
}));

/** El Supervisor toma la alerta en revisión o agrega notas. La alerta solo se resuelve con una verificación coincidente posterior. */
alertasRouter.post('/:id/revisar', requirePermission('revisar_alerta'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const b = z.object({ notas: z.string().trim().min(5, 'Escriba una nota de revisión (mínimo 5 caracteres).').max(1500) }).parse(req.body);
  await tx(async c => {
    const a = await one(c, `${SEL} where a.id_alerta=$1 for update of a`, [id]);
    if (!a) throw notFound('Alerta no encontrada.');
    if (['resuelta', 'descartada'].includes(a.estado)) throw conflict('La alerta ya fue resuelta.');
    if (a.estado === 'pendiente') {
      await q(c, `update alertas_integridad set estado='en_revision', id_supervisor_revisor=$2, fecha_revision=now() where id_alerta=$1`, [id, u.id]);
      await q(c, `update evidencias set integridad='en_revision' where id_evidencia=$1`, [a.id_evidencia]);
    }
    await q(c, `insert into alertas_historial (id_alerta,id_usuario,accion,notas) values ($1,$2,$3,$4)`, [id, u.id, a.estado === 'pendiente' ? 'Revisión iniciada' : 'Nota de revisión', b.notas]);
    const ev = await one(c, 'select * from evidencias where id_evidencia=$1', [a.id_evidencia]);
    await evento(c, u, ev, 'Revisión de alerta', `${a.codigo}: ${b.notas}`);
    await audit(c, u, req, { modulo: 'Integridad', accion: 'Revisión de alerta', referencia: a.codigo, id_caso: a.id_caso, id_evidencia: a.id_evidencia, descripcion: b.notas });
  });
  res.json({ ok: true });
}));
