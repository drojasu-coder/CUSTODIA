import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit';
import { codigoNuevo } from '../access';
import { authenticate, requirePermission } from '../auth';
import { one, pool, q, tx } from '../db';
import { conflict, notFound, wrap , idParam } from '../errors';

export const catalogosRouter = Router();

// Ubicaciones activas con cupo, para formularios de registro y transferencia.
catalogosRouter.get('/ubicaciones-activas', requirePermission('registrar_evidencia', 'transferir_custodia'), wrap(async (_req, res) => {
  res.json(await q(pool, `select ub.id_ubicacion, ub.codigo, ub.nombre, ub.tipo, ub.capacidad,
    (select count(*)::int from evidencias e where e.id_ubicacion=ub.id_ubicacion and e.estado<>'archivada') as ocupacion from ubicaciones ub where ub.activo order by ub.codigo`));
}));

catalogosRouter.get('/ubicaciones', requirePermission('consultar_ubicaciones'), wrap(async (req, res) => {
  const u = req.user!;
  const rows = await q(pool, `select ub.*, (select count(*)::int from evidencias e where e.id_ubicacion=ub.id_ubicacion and e.estado<>'archivada') as ocupacion
    from ubicaciones ub order by ub.codigo`);
  // Administración ve ocupación pero nunca el contenido de evidencia (RN: separación de funciones).
  const verContenido = u.rol !== 'Administrador';
  for (const r of rows) {
    r.evidencias = verContenido ? await q(pool, `select e.id_evidencia, e.codigo_unico, e.nombre_referencia, e.estado from evidencias e
        where e.id_ubicacion=$1 and e.estado<>'archivada' and puede_ver_evidencia($2,$3,e.id_evidencia) order by e.codigo_unico`, [r.id_ubicacion, u.id, u.rol]) : [];
  }
  res.json(rows);
}));

const ubSchema = z.object({
  nombre: z.string().trim().min(3).max(180), tipo: z.enum(['fisica', 'logica']),
  capacidad: z.number().int().min(1).max(100000),
});
catalogosRouter.post('/ubicaciones', requirePermission('administrar_catalogos'), wrap(async (req, res) => {
  const b = ubSchema.parse(req.body);
  const row = await tx(async c => {
    const n = (await one(c, 'select count(*)::int n from ubicaciones'))!.n + 1;
    const r = await one(c, 'insert into ubicaciones (codigo,nombre,tipo,capacidad) values ($1,$2,$3,$4) returning *', [`LOC-${String(n).padStart(3, '0')}`, b.nombre, b.tipo, b.capacidad]);
    await audit(c, req.user!, req, { modulo: 'Catálogos', accion: 'Alta de ubicación', referencia: r.codigo, descripcion: b.nombre });
    return r;
  });
  res.status(201).json(row);
}));
catalogosRouter.patch('/ubicaciones/:id', requirePermission('administrar_catalogos'), wrap(async (req, res) => {
  const id = idParam(req);
  const b = ubSchema.partial().extend({ activo: z.boolean().optional() }).parse(req.body);
  await tx(async c => {
    const ub = await one(c, `select ub.*, (select count(*)::int from evidencias e where e.id_ubicacion=ub.id_ubicacion and e.estado<>'archivada') as ocupacion from ubicaciones ub where id_ubicacion=$1 for update`, [id]);
    if (!ub) throw notFound('Ubicación no encontrada.');
    if (b.capacidad !== undefined && b.capacidad < ub.ocupacion) throw conflict(`La capacidad no puede ser menor a la ocupación actual (${ub.ocupacion}).`);
    if (b.activo === false && ub.ocupacion > 0) throw conflict('No se puede desactivar una ubicación con evidencia almacenada.');
    await q(c, `update ubicaciones set nombre=coalesce($2,nombre), tipo=coalesce($3,tipo), capacidad=coalesce($4,capacidad), activo=coalesce($5,activo) where id_ubicacion=$1`,
      [id, b.nombre ?? null, b.tipo ?? null, b.capacidad ?? null, b.activo ?? null]);
    await audit(c, req.user!, req, { modulo: 'Catálogos', accion: 'Modificación de ubicación', referencia: ub.codigo, descripcion: JSON.stringify(b) });
  });
  res.json({ ok: true });
}));

// Tipos de evidencia: lectura para cualquier sesión (los formularios los necesitan).
catalogosRouter.get('/tipos-evidencia', authenticate, wrap(async (_req, res) => {
  res.json(await q(pool, 'select id_tipo, nombre, activo from tipos_evidencia order by nombre'));
}));
catalogosRouter.post('/tipos-evidencia', authenticate, requirePermission('administrar_catalogos'), wrap(async (req, res) => {
  const b = z.object({ nombre: z.string().trim().min(3).max(80) }).parse(req.body);
  const r = await one(pool, 'insert into tipos_evidencia (nombre) values ($1) returning *', [b.nombre]);
  await audit(pool, req.user!, req, { modulo: 'Catálogos', accion: 'Alta de tipo de evidencia', referencia: String(r.id_tipo), descripcion: b.nombre });
  res.status(201).json(r);
}));
catalogosRouter.patch('/tipos-evidencia/:id', authenticate, requirePermission('administrar_catalogos'), wrap(async (req, res) => {
  const b = z.object({ nombre: z.string().trim().min(3).max(80).optional(), activo: z.boolean().optional() }).parse(req.body);
  const r = await one(pool, 'update tipos_evidencia set nombre=coalesce($2,nombre), activo=coalesce($3,activo) where id_tipo=$1 returning *', [idParam(req), b.nombre ?? null, b.activo ?? null]);
  if (!r) throw notFound('Tipo no encontrado.');
  await audit(pool, req.user!, req, { modulo: 'Catálogos', accion: 'Modificación de tipo de evidencia', referencia: String(r.id_tipo), descripcion: JSON.stringify(b) });
  res.json(r);
}));
void codigoNuevo;

// Usuarios mínimos para formularios (Supervisor asigna recolectores, etc.) están en sus rutas; aquí nada más.
