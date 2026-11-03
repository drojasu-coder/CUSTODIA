import { Router } from 'express';
import { z } from 'zod';
import { audit, evento } from '../audit';
import { casoAbierto, codigoNuevo, expirarSolicitudes } from '../access';
import { requirePermission } from '../auth';
import { one, pool, q, tx } from '../db';
import { conflict, forbidden, notFound, wrap , idParam } from '../errors';
import { pageParams } from '../util';

export const analisisRouter = Router();
const SEL = `select a.*, ev.codigo_unico, ev.nombre_referencia, ev.id_caso, ca.codigo_caso, so.codigo as codigo_solicitud, cp.codigo as codigo_copia,
    us.nombres||' '||us.apellidos as analista
  from analisis_forenses a join evidencias ev using(id_evidencia) join casos ca using(id_caso) join solicitudes_acceso so using(id_solicitud)
  join copias_autorizadas cp using(id_copia) join usuarios us on us.id_usuario=a.id_analista`;

analisisRouter.get('/', requirePermission('consultar_analisis'), wrap(async (req, res) => {
  const u = req.user!, { page, size, offset } = pageParams(req.query);
  const full = ['Supervisor', 'Auditor'].includes(u.rol);
  const total = (await one(pool, `select count(*)::int n from analisis_forenses a where $1::boolean or a.id_analista=$2`, [full, u.id]))!.n;
  const items = await q(pool, `${SEL} where $1::boolean or a.id_analista=$2 order by a.id_analisis desc limit $3 offset $4`, [full, u.id, size, offset]);
  res.json({ total, page, size, items });
}));

analisisRouter.get('/:id', requirePermission('consultar_analisis'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const a = await one(pool, `${SEL} where a.id_analisis=$1`, [id]);
  if (!a) throw notFound('Análisis no encontrado.');
  if (!['Supervisor', 'Auditor'].includes(u.rol) && a.id_analista !== u.id) throw forbidden('No tiene acceso a este análisis.');
  const notas = await q(pool, `select n.*, us.nombres||' '||us.apellidos as usuario from analisis_notas n join usuarios us using(id_usuario) where id_analisis=$1 order by id_nota`, [id]);
  res.json({ ...a, notas });
}));

analisisRouter.post('/', requirePermission('registrar_analisis'), wrap(async (req, res) => {
  const u = req.user!;
  const b = z.object({
    id_solicitud: z.number().int(),
    proposito: z.string().trim().min(5).max(250), actividad_realizada: z.string().trim().min(10).max(4000),
    herramientas: z.string().trim().min(3).max(250), resultado: z.string().trim().min(10).max(6000),
    conclusiones: z.string().trim().min(10).max(4000),
    fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    observaciones: z.string().trim().max(1500).optional(),
  }).refine(v => v.fecha_inicio <= v.fecha_fin, { message: 'La fecha de inicio no puede ser posterior a la de fin.', path: ['fecha_fin'] }).parse(req.body);
  await expirarSolicitudes();
  const a = await tx(async c => {
    const s = await one(c, `select s.*, ev.codigo_unico, ev.id_caso, ca.estado as estado_caso, cp.id_copia
      from solicitudes_acceso s join evidencias ev using(id_evidencia) join casos ca using(id_caso)
      join copias_autorizadas cp on cp.id_solicitud=s.id_solicitud and cp.id_propietario=$2
      where s.id_solicitud=$1 and s.id_solicitante=$2 and s.estado='aprobada' and s.fecha_vencimiento>=hoy_gt() for update of s`, [b.id_solicitud, u.id]);
    if (!s) throw forbidden('Necesita una solicitud aprobada y vigente con copia autorizada propia.');
    casoAbierto({ estado: s.estado_caso });
    if (await one(c, 'select 1 from analisis_forenses where id_solicitud=$1', [b.id_solicitud])) throw conflict('Ya existe un análisis registrado para esta solicitud. Agregue una nota complementaria.');
    const codigo = await codigoNuevo(c, 'ANA');
    const row = await one(c, `insert into analisis_forenses (codigo,id_evidencia,id_solicitud,id_copia,id_analista,proposito,actividad_realizada,herramientas,resultado,conclusiones,fecha_inicio,fecha_fin,observaciones)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [codigo, s.id_evidencia, s.id_solicitud, s.id_copia, u.id, b.proposito, b.actividad_realizada, b.herramientas, b.resultado, b.conclusiones, b.fecha_inicio, b.fecha_fin, b.observaciones ?? null]);
    await evento(c, u, { id_evidencia: s.id_evidencia, id_caso: s.id_caso }, 'Análisis forense registrado', `${codigo} sobre copia autorizada. Solo hallazgos; el original no se tocó.`);
    await audit(c, u, req, { modulo: 'Análisis', accion: 'Registro de análisis', referencia: codigo, id_caso: s.id_caso, id_evidencia: s.id_evidencia, descripcion: b.proposito });
    return row;
  });
  res.status(201).json(a);
}));

/** Los análisis no se editan (RN-22); las aclaraciones posteriores se agregan como notas. */
analisisRouter.post('/:id/notas', requirePermission('registrar_analisis'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const b = z.object({ texto: z.string().trim().min(5, 'La nota debe tener al menos 5 caracteres.').max(2000) }).parse(req.body);
  await tx(async c => {
    const a = await one(c, `${SEL} where a.id_analisis=$1`, [id]);
    if (!a || a.id_analista !== u.id) throw notFound('Análisis no encontrado.');
    casoAbierto({ estado: (await one(c, 'select estado from casos where id_caso=$1', [a.id_caso]))!.estado });
    await q(c, 'insert into analisis_notas (id_analisis,id_usuario,texto) values ($1,$2,$3)', [id, u.id, b.texto]);
    await audit(c, u, req, { modulo: 'Análisis', accion: 'Nota complementaria', referencia: a.codigo, id_caso: a.id_caso, id_evidencia: a.id_evidencia });
  });
  res.status(201).json({ ok: true });
}));
