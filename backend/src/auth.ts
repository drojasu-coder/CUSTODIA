import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { one, q, pool } from './db';
import { forbidden, HttpError } from './errors';
import { AuthUser, nombreCompleto } from './util';

declare global { namespace Express { interface Request { user?: AuthUser } } }

export const signToken = (id: number) => jwt.sign({ sub: String(id) }, config.jwtSecret, { expiresIn: config.jwtExpires } as jwt.SignOptions);

export async function loadUser(id: number): Promise<AuthUser | null> {
  const u = await one(pool, `select u.id_usuario, u.codigo, u.nombres, u.apellidos, u.correo, u.unidad, r.nombre as rol
      from usuarios u join roles r using (id_rol) where u.id_usuario=$1 and u.activo and r.activo`, [id]);
  if (!u) return null;
  const perms = await q(pool, `select p.codigo from rol_permiso rp join permisos p using (id_permiso)
      join usuarios u on u.id_rol=rp.id_rol where u.id_usuario=$1`, [id]);
  return { id: u.id_usuario, codigo: u.codigo, nombre: nombreCompleto(u), rol: u.rol, correo: u.correo, unidad: u.unidad,
           permisos: perms.map(p => p.codigo) };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    // El token también se acepta por query solo para descargas con <a href> (si se habilita en el cliente).
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    if (!token) throw new HttpError(401, 'Sesión no iniciada.', 'sin_sesion');
    let sub: number;
    try { sub = Number((jwt.verify(token, config.jwtSecret) as any).sub); }
    catch { throw new HttpError(401, 'La sesión expiró. Inicie sesión de nuevo.', 'sesion_expirada'); }
    const u = await loadUser(sub);
    if (!u) throw new HttpError(401, 'La cuenta no está activa.', 'cuenta_inactiva');
    req.user = u;
    next();
  } catch (e) { next(e); }
}

export const hasPerm = (u: AuthUser, p: string) => u.permisos.includes(p);

/** Permiso por rol (matriz). Las condiciones por objeto se validan en cada ruta. */
export const requirePermission = (...codes: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, 'Sesión no iniciada.', 'sin_sesion'));
  if (!codes.some(c => hasPerm(req.user!, c))) {
    return next(Object.assign(forbidden(), { auditDenied: true }));
  }
  next();
};
