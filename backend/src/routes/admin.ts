import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { audit } from '../audit';
import { requirePermission } from '../auth';
import { one, pool, q, tx } from '../db';
import { bad, conflict, notFound, wrap , idParam } from '../errors';
import { passwordSchema } from './auth';

export const adminRouter = Router();
const usr = `select u.id_usuario, u.codigo, u.nombres, u.apellidos, u.correo, u.nombre_usuario, u.unidad, u.activo, u.fecha_creacion, u.ultimo_acceso, r.nombre as rol, u.id_rol
  from usuarios u join roles r using(id_rol)`;

adminRouter.get('/usuarios', requirePermission('administrar_usuarios'), wrap(async (_req, res) => {
  res.json(await q(pool, `${usr} order by u.codigo`));
}));

adminRouter.post('/usuarios', requirePermission('administrar_usuarios'), wrap(async (req, res) => {
  const b = z.object({
    nombres: z.string().trim().min(2).max(80), apellidos: z.string().trim().min(2).max(80),
    correo: z.string().trim().email('Correo inválido.').max(120), nombre_usuario: z.string().trim().regex(/^[a-z0-9._-]{3,50}$/i, 'Usuario: 3-50 caracteres (letras, números, . _ -).').optional(),
    unidad: z.string().trim().max(150).default(''), id_rol: z.number().int(), contrasena: passwordSchema,
  }).parse(req.body);
  const row = await tx(async c => {
    if (!(await one(c, 'select 1 from roles where id_rol=$1 and activo', [b.id_rol]))) throw bad('Rol inválido.');
    const n = (await one(c, 'select coalesce(max(substring(codigo from 5)::int),0)+1 n from usuarios'))!.n;
    const r = await one(c, `insert into usuarios (codigo,id_rol,nombres,apellidos,correo,nombre_usuario,unidad,contrasena_hash) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id_usuario,codigo`,
      [`USR-${String(n).padStart(2, '0')}`, b.id_rol, b.nombres, b.apellidos, b.correo, b.nombre_usuario ?? b.correo.split('@')[0], b.unidad, await bcrypt.hash(b.contrasena, 10)]);
    await audit(c, req.user!, req, { modulo: 'Administración', accion: 'Alta de usuario', referencia: r.codigo, descripcion: b.correo });
    return r;
  });
  res.status(201).json(row);
}));

adminRouter.patch('/usuarios/:id', requirePermission('administrar_usuarios'), wrap(async (req, res) => {
  const id = idParam(req), me = req.user!;
  const b = z.object({
    nombres: z.string().trim().min(2).max(80).optional(), apellidos: z.string().trim().min(2).max(80).optional(),
    correo: z.string().trim().email().max(120).optional(), unidad: z.string().trim().max(150).optional(),
    id_rol: z.number().int().optional(), activo: z.boolean().optional(), contrasena: passwordSchema.optional(),
  }).parse(req.body);
  await tx(async c => {
    const u = await one(c, `${usr} where u.id_usuario=$1 for update of u`, [id]);
    if (!u) throw notFound('Usuario no encontrado.');
    if (id === me.id && ((b.activo === false) || (b.id_rol !== undefined && b.id_rol !== u.id_rol))) throw conflict('No puede desactivarse ni cambiar su propio rol.');
    if (u.rol === 'Administrador' && u.activo && (b.activo === false || (b.id_rol !== undefined && b.id_rol !== u.id_rol))) {
      const otros = (await one(c, `select count(*)::int n from usuarios us join roles r using(id_rol) where r.nombre='Administrador' and us.activo and us.id_usuario<>$1`, [id]))!.n;
      if (!otros) throw conflict('Debe existir al menos un administrador activo.');
    }
    if (b.id_rol !== undefined && !(await one(c, 'select 1 from roles where id_rol=$1 and activo', [b.id_rol]))) throw bad('Rol inválido.');
    // Un responsable con custodia vigente no puede quedar inactivo ni cambiar de rol: la evidencia quedaría sin custodio válido.
    if (u.activo && (b.activo === false || (b.id_rol !== undefined && b.id_rol !== u.id_rol))) {
      const p = await one(c, `select (select count(*)::int from evidencias where id_custodio_actual=$1 and estado<>'archivada') ev,
          (select count(*)::int from transferencias_custodia where estado in ('pendiente','autorizada') and (id_entregante=$1 or id_receptor=$1)) tr`, [id]);
      if (p.ev || p.tr) throw conflict(`El usuario tiene ${p.ev} evidencia(s) bajo su custodia y ${p.tr} transferencia(s) abiertas: transfiera la custodia antes de desactivarlo o cambiar su rol.`);
    }
    await q(c, `update usuarios set nombres=coalesce($2,nombres), apellidos=coalesce($3,apellidos), correo=coalesce($4,correo), unidad=coalesce($5,unidad),
        id_rol=coalesce($6,id_rol), activo=coalesce($7,activo), contrasena_hash=coalesce($8,contrasena_hash) where id_usuario=$1`,
      [id, b.nombres ?? null, b.apellidos ?? null, b.correo ?? null, b.unidad ?? null, b.id_rol ?? null, b.activo ?? null, b.contrasena ? await bcrypt.hash(b.contrasena, 10) : null]);
    const cambios = Object.keys(b).filter(k => k !== 'contrasena').concat(b.contrasena ? ['contraseña restablecida'] : []);
    await audit(c, me, req, { modulo: 'Administración', accion: b.activo === false ? 'Desactivación de usuario' : b.contrasena ? 'Restablecimiento de contraseña' : 'Modificación de usuario', referencia: u.codigo, descripcion: cambios.join(', ') });
  });
  res.json({ ok: true });
}));

adminRouter.get('/roles', requirePermission('administrar_usuarios'), wrap(async (_req, res) => {
  const roles = await q(pool, `select r.id_rol, r.nombre, r.descripcion, r.activo, (select count(*)::int from usuarios u where u.id_rol=r.id_rol) as usuarios from roles r order by r.id_rol`);
  const perms = await q(pool, `select p.id_permiso, p.codigo, p.nombre, p.descripcion from permisos p order by p.id_permiso`);
  const asig = await q(pool, `select id_rol, id_permiso from rol_permiso`);
  res.json({ roles, permisos: perms, asignaciones: asig });
}));

adminRouter.get('/configuracion', requirePermission('administrar_configuracion'), wrap(async (_req, res) => {
  res.json(Object.fromEntries((await q(pool, 'select clave, valor from configuracion')).map(r => [r.clave, r.valor])));
}));
adminRouter.put('/configuracion', requirePermission('administrar_configuracion'), wrap(async (req, res) => {
  const b = z.object({
    organizacion: z.string().trim().min(3).max(150), correo_soporte: z.string().trim().email(),
    vigencia_acceso_dias: z.number().int().min(1).max(30), max_adjunto_kb: z.number().int().min(1).max(102400),
  }).parse(req.body);
  await tx(async c => {
    for (const [k, v] of Object.entries(b)) await q(c, 'insert into configuracion (clave,valor) values ($1,$2) on conflict (clave) do update set valor=excluded.valor', [k, String(v)]);
    await audit(c, req.user!, req, { modulo: 'Administración', accion: 'Cambio de configuración', referencia: 'configuracion', descripcion: JSON.stringify(b) });
  });
  res.json({ ok: true });
}));

/** Respaldo lógico de catálogos y cuentas. Nunca incluye hashes de contraseña ni contenido de evidencia. */
adminRouter.post('/respaldo', requirePermission('administrar_configuracion'), wrap(async (req, res) => {
  const data = {
    generado: new Date().toISOString(), version: 1,
    usuarios: await q(pool, `select codigo,nombres,apellidos,correo,nombre_usuario,unidad,activo,fecha_creacion from usuarios order by 1`),
    roles: await q(pool, 'select * from roles order by 1'),
    ubicaciones: await q(pool, 'select * from ubicaciones order by 1'),
    tipos_evidencia: await q(pool, 'select * from tipos_evidencia order by 1'),
    configuracion: await q(pool, 'select * from configuracion order by 1'),
  };
  await q(pool, `update configuracion set valor=$1 where clave='ultimo_respaldo'`, [data.generado]);
  await audit(pool, req.user!, req, { modulo: 'Administración', accion: 'Respaldo lógico', referencia: 'respaldo' });
  res.set({ 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="respaldo_custodia.json"' }).send(JSON.stringify(data, null, 2));
}));

adminRouter.get('/resumen', requirePermission('administrar_usuarios'), wrap(async (_req, res) => {
  res.json(await one(pool, `select (select count(*)::int from usuarios) usuarios, (select count(*)::int from usuarios where activo) activos,
    (select count(*)::int from roles) roles, (select count(*)::int from ubicaciones where activo) ubicaciones,
    (select count(*)::int from bitacora_auditoria where modulo in ('Autenticación','Seguridad') and resultado<>'exitoso' and fecha_hora > now() - interval '7 days') accesos_fallidos,
    (select valor from configuracion where clave='ultimo_respaldo') ultimo_respaldo`));
}));
