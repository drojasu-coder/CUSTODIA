import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { audit } from '../audit';
import { authenticate, loadUser, signToken } from '../auth';
import { one, pool, q } from '../db';
import { bad, HttpError, wrap } from '../errors';

export const authRouter = Router();

// Por IP: solo cuentan los intentos fallidos (los accesos correctos no bloquean a usuarios legítimos de la misma red).
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true, message: { error: 'Demasiados intentos. Espere unos minutos.', codigo: 'limite' } });

// Por cuenta: tras MAX_FALLOS intentos fallidos en VENTANA, la cuenta queda bloqueada BLOQUEO ms (en memoria;
// un servicio con una sola instancia). Un acceso correcto reinicia el contador.
const MAX_FALLOS = process.env.NODE_ENV === 'test' ? 1000 : 5, VENTANA = 15 * 60 * 1000, BLOQUEO = 15 * 60 * 1000;
const fallos = new Map<string, { n: number; desde: number; hasta: number }>();
function bloqueada(k: string) {
  const f = fallos.get(k), now = Date.now();
  if (!f) return 0;
  if (f.hasta > now) return Math.ceil((f.hasta - now) / 60000);
  if (now - f.desde > VENTANA) fallos.delete(k);
  return 0;
}
function registrarFallo(k: string) {
  const now = Date.now(), f = fallos.get(k);
  const r = !f || now - f.desde > VENTANA ? { n: 1, desde: now, hasta: 0 } : { ...f, n: f.n + 1 };
  if (r.n >= MAX_FALLOS) r.hasta = now + BLOQUEO;
  fallos.set(k, r);
  if (fallos.size > 10000) for (const [key, v] of fallos) if (now - v.desde > VENTANA && v.hasta < now) fallos.delete(key);
  return r.hasta > now;
}

export const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .regex(/[A-Za-z]/, 'La contraseña debe incluir letras.').regex(/\d/, 'La contraseña debe incluir un número.');

authRouter.post('/login', limiter, wrap(async (req, res) => {
  const b = z.object({ usuario: z.string().trim().min(1, 'Ingrese su usuario.').max(120), contrasena: z.string().min(1, 'Ingrese su contraseña.').max(200) }).parse(req.body);
  const clave = b.usuario.trim().toLowerCase().slice(0, 120);
  const min = bloqueada(clave);
  if (min) {
    await audit(pool, null, req, { modulo: 'Autenticación', accion: 'Acceso bloqueado temporalmente', referencia: '', descripcion: 'Demasiados intentos fallidos para la cuenta.', resultado: 'rechazado' }, b.usuario.slice(0, 80));
    throw new HttpError(429, `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo en ${min} min.`, 'cuenta_bloqueada');
  }
  const u = await one(pool, `select * from usuarios where lower(correo)=lower($1) or lower(nombre_usuario)=lower($1)`, [b.usuario.trim()]);
  const okPass = u ? await bcrypt.compare(b.contrasena, u.contrasena_hash) : await bcrypt.compare(b.contrasena, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!u || !okPass || !u.activo) {
    await audit(pool, null, req, { modulo: 'Autenticación', accion: 'Intento de acceso fallido', referencia: u?.codigo ?? '',
      descripcion: u && !u.activo ? 'Cuenta inactiva.' : 'Credenciales incorrectas.', resultado: 'rechazado' }, b.usuario.slice(0, 80));
    if (registrarFallo(clave)) {
      await audit(pool, null, req, { modulo: 'Seguridad', accion: 'Bloqueo temporal de cuenta', referencia: u?.codigo ?? '', descripcion: `${MAX_FALLOS} intentos fallidos consecutivos.`, resultado: 'critico' }, b.usuario.slice(0, 80));
    }
    throw new HttpError(401, 'Usuario o contraseña incorrectos.', 'credenciales');
  }
  fallos.delete(clave);
  await q(pool, 'update usuarios set ultimo_acceso=now() where id_usuario=$1', [u.id_usuario]);
  const user = (await loadUser(u.id_usuario))!;
  await audit(pool, user, req, { modulo: 'Autenticación', accion: 'Inicio de sesión', referencia: user.codigo });
  res.json({ token: signToken(u.id_usuario), usuario: user });
}));

authRouter.get('/me', authenticate, wrap(async (req, res) => { res.json({ usuario: req.user }); }));

authRouter.post('/logout', authenticate, wrap(async (req, res) => {
  await audit(pool, req.user!, req, { modulo: 'Autenticación', accion: 'Cierre de sesión', referencia: req.user!.codigo });
  res.json({ ok: true });
}));

authRouter.patch('/me', authenticate, wrap(async (req, res) => {
  const b = z.object({
    nombres: z.string().trim().min(2).max(80).optional(),
    apellidos: z.string().trim().min(2).max(80).optional(),
    unidad: z.string().trim().max(150).optional(),
    contrasena_actual: z.string().optional(),
    contrasena_nueva: passwordSchema.optional(),
  }).parse(req.body);
  if (b.contrasena_nueva) {
    const row = await one(pool, 'select contrasena_hash from usuarios where id_usuario=$1', [req.user!.id]);
    if (!b.contrasena_actual || !(await bcrypt.compare(b.contrasena_actual, row.contrasena_hash))) throw bad('La contraseña actual no es correcta.');
    await q(pool, 'update usuarios set contrasena_hash=$2 where id_usuario=$1', [req.user!.id, await bcrypt.hash(b.contrasena_nueva, 10)]);
    await audit(pool, req.user!, req, { modulo: 'Seguridad', accion: 'Cambio de contraseña', referencia: req.user!.codigo });
  }
  await q(pool, `update usuarios set nombres=coalesce($2,nombres), apellidos=coalesce($3,apellidos), unidad=coalesce($4,unidad) where id_usuario=$1`,
    [req.user!.id, b.nombres ?? null, b.apellidos ?? null, b.unidad ?? null]);
  if (b.nombres || b.apellidos || b.unidad) await audit(pool, req.user!, req, { modulo: 'Seguridad', accion: 'Actualización de perfil', referencia: req.user!.codigo });
  res.json({ usuario: await loadUser(req.user!.id) });
}));
