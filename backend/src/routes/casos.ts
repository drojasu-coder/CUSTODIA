import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit';
import { casoAbierto, casoVisible, codigoNuevo } from '../access';
import { requirePermission } from '../auth';
import { one, pool, q, tx } from '../db';
import { bad, conflict, wrap , idParam } from '../errors';
import { pageParams } from '../util';

export const casosRouter = Router();

casosRouter.get('/', requirePermission('consultar_casos'), wrap(async (req, res) => {
  const u = req.user!, { page, size, offset } = pageParams(req.query);
  const estado = typeof req.query.estado === 'string' ? req.query.estado : null;
  const busq = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
  const where = `puede_ver_caso($1,$2,c.id_caso) and ($3::text is null or c.estado::text=$3)
     and ($4::text is null or c.codigo_caso ilike $4 or c.titulo ilike $4 or c.tipo_incidente ilike $4)`;
  const total = (await one(pool, `select count(*)::int n from casos c where ${where}`, [u.id, u.rol, estado, busq]))!.n;
  const rows = await q(pool, `select c.id_caso, c.codigo_caso, c.titulo, c.tipo_incidente, c.lugar, c.estado, c.fecha_reporte,
      (select nombres||' '||apellidos from usuarios where id_usuario=c.id_reportante) as reportante,
      (select count(*)::int from evidencias e where e.id_caso=c.id_caso and puede_ver_evidencia($1,$2,e.id_evidencia)) as evidencias
    from casos c where ${where} order by c.fecha_reporte desc, c.id_caso desc limit $5 offset $6`,
    [u.id, u.rol, estado, busq, size, offset]);
  res.json({ total, page, size, items: rows });
}));

casosRouter.post('/', requirePermission('crear_caso'), wrap(async (req, res) => {
  const b = z.object({
    titulo: z.string().trim().min(5, 'El título debe tener al menos 5 caracteres.').max(180),
    descripcion: z.string().trim().min(10, 'Describa el incidente (mínimo 10 caracteres).').max(4000),
    tipo_incidente: z.string().trim().min(3).max(80),
    lugar: z.string().trim().min(3).max(180),
  }).parse(req.body);
  const caso = await tx(async c => {
    const codigo = await codigoNuevo(c, 'CAS');
    const r = await one(c, `insert into casos (codigo_caso,titulo,descripcion,tipo_incidente,lugar,id_reportante,id_responsable)
      values ($1,$2,$3,$4,$5,$6,(select id_usuario from usuarios u join roles r using(id_rol) where r.nombre='Supervisor' and u.activo order by u.id_usuario limit 1))
      returning *`, [codigo, b.titulo, b.descripcion, b.tipo_incidente, b.lugar, req.user!.id]);
    await audit(c, req.user!, req, { modulo: 'Casos', accion: 'Registro de incidente', referencia: codigo, id_caso: r.id_caso, descripcion: b.titulo });
    return r;
  });
  res.status(201).json(caso);
}));

casosRouter.get('/:id', requirePermission('consultar_casos'), wrap(async (req, res) => {
  const u = req.user!, id = idParam(req);
  const caso = await casoVisible(u, id);
  const evidencias = await q(pool, `select e.id_evidencia, e.codigo_unico, e.nombre_referencia, t.nombre as tipo, e.estado, e.integridad, e.fecha_recoleccion,
      (select nombres||' '||apellidos from usuarios where id_usuario=e.id_custodio_actual) as custodio
    from evidencias e join tipos_evidencia t using (id_tipo) where e.id_caso=$1 and puede_ver_evidencia($2,$3,e.id_evidencia) order by e.id_evidencia`, [id, u.id, u.rol]);
  const asignados = await q(pool, `select u.id_usuario, u.nombres||' '||u.apellidos as nombre, a.fecha from caso_asignaciones a join usuarios u using (id_usuario) where a.id_caso=$1`, [id]);
  const pend = (await one(pool, 'select pendientes_cierre($1) as p', [id]))!.p as string[];
  res.json({ ...caso, evidencias, asignados, pendientes_cierre: pend });
}));

casosRouter.post('/:id/asignar', requirePermission('asignar_caso'), wrap(async (req, res) => {
  const id = idParam(req);
  const b = z.object({ id_usuario: z.number().int() }).parse(req.body);
  await tx(async c => {
    const caso = await casoVisible(req.user!, id, c); casoAbierto(caso);
    const rec = await one(c, `select u.id_usuario, u.nombres||' '||u.apellidos as n from usuarios u join roles r using(id_rol) where u.id_usuario=$1 and r.nombre='Recolector' and u.activo`, [b.id_usuario]);
    if (!rec) throw bad('Solo puede asignarse a un Recolector activo.');
    const ins = await q(c, 'insert into caso_asignaciones (id_caso,id_usuario) values ($1,$2) on conflict do nothing returning 1', [id, b.id_usuario]);
    if (!ins.length) throw conflict('El recolector ya está asignado a este caso.');
    if (caso.estado === 'abierto') await q(c, `update casos set estado='en_investigacion' where id_caso=$1`, [id]);
    await audit(c, req.user!, req, { modulo: 'Casos', accion: 'Asignación de recolector', referencia: caso.codigo_caso, id_caso: id, descripcion: `Asignado: ${rec.n}` });
  });
  res.json({ ok: true });
}));

casosRouter.get('/:id/recolectores', requirePermission('asignar_caso'), wrap(async (_req, res) => {
  res.json(await q(pool, `select u.id_usuario, u.nombres||' '||u.apellidos as nombre from usuarios u join roles r using(id_rol) where r.nombre='Recolector' and u.activo order by 2`));
}));

casosRouter.post('/:id/estado', requirePermission('cerrar_caso'), wrap(async (req, res) => {
  const id = idParam(req);
  const b = z.object({
    estado: z.enum(['en_investigacion', 'suspendido', 'cerrado']),
    motivo: z.string().trim().max(1000).optional(),
  }).parse(req.body);
  await tx(async c => {
    const caso = await casoVisible(req.user!, id, c); casoAbierto(caso);
    if (b.estado === 'cerrado') {
      if (!b.motivo || b.motivo.length < 10) throw bad('El cierre requiere un motivo documentado (mínimo 10 caracteres).');
      const pend = (await one(c, 'select pendientes_cierre($1) as p', [id]))!.p as string[];
      if (pend.length) throw conflict(`El caso no puede cerrarse: ${pend.join(', ')}.`);
      await q(c, `update casos set estado='cerrado', fecha_cierre=now(), motivo_cierre=$2, id_supervisor_cierre=$3 where id_caso=$1`, [id, b.motivo, req.user!.id]);
      await q(c, `update evidencias set estado='archivada' where id_caso=$1`, [id]);
      // Los accesos aprobados a copias de trabajo terminan con el caso (la copia deja de descargarse).
      await q(c, `update solicitudes_acceso set estado='cerrada' where estado='aprobada' and id_evidencia in (select id_evidencia from evidencias where id_caso=$1)`, [id]);
      await audit(c, req.user!, req, { modulo: 'Casos', accion: 'Cierre de caso', referencia: caso.codigo_caso, id_caso: id, descripcion: b.motivo });
    } else {
      await q(c, 'update casos set estado=$2 where id_caso=$1', [id, b.estado]);
      await audit(c, req.user!, req, { modulo: 'Casos', accion: 'Cambio de estado', referencia: caso.codigo_caso, id_caso: id, descripcion: `${caso.estado} → ${b.estado}` });
    }
  });
  res.json({ ok: true });
}));
