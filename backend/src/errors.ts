import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { audit } from './audit';
import { pool } from './db';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}
export const bad = (m: string) => new HttpError(400, m, 'validacion');
export const forbidden = (m = 'No tiene permiso para realizar esta acción.') => new HttpError(403, m, 'prohibido');
export const notFound = (m = 'Registro no encontrado.') => new HttpError(404, m, 'no_encontrado');
export const conflict = (m: string) => new HttpError(409, m, 'conflicto');

export const wrap = (fn: (req: any, res: any) => Promise<any>): RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError && err.status === 403 && req.user) {
    audit(pool, req.user, req, { modulo: 'Seguridad', accion: 'Acceso denegado', referencia: `${req.method} ${req.baseUrl}${req.path}`.slice(0, 120), descripcion: err.message, resultado: 'rechazado' }).catch(() => {});
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, codigo: err.code });
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.') || 'dato'}: ${i.message}`).join('; '), codigo: 'validacion' });
  }
  if (err?.code === 'CD001') return res.status(409).json({ error: err.message, codigo: 'registro_protegido' });
  if (err?.code === 'CD002') return res.status(409).json({ error: err.message, codigo: 'regla_negocio' });
  if (err?.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con esos datos.', codigo: 'duplicado' });
  if (err?.code === '23503') return res.status(400).json({ error: 'Referencia inválida.', codigo: 'referencia' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo excede el tamaño máximo permitido.', codigo: 'archivo_grande' });
  if (err?.name === 'MulterError') return res.status(400).json({ error: 'Envíe un único archivo en el campo "archivo".', codigo: 'archivo_invalido' });
  if (err?.code === '22P02' || err?.code === '22003' || err?.code === '22007' || err?.code === '22008') {
    return res.status(400).json({ error: 'Identificador o dato con formato inválido.', codigo: 'validacion' });
  }
  if (err?.code === '23514') return res.status(400).json({ error: 'Los datos no cumplen las reglas del registro.', codigo: 'validacion' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.', codigo: 'validacion' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande.', codigo: 'archivo_grande' });
  // Solo se registra el error (sin cuerpo de la solicitud ni cabeceras: pueden contener credenciales).
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl.split('?')[0]}:`, err?.code ?? '', err?.message ?? err, err?.stack?.split('\n')[1]?.trim() ?? '');
  res.status(500).json({ error: 'Error interno del servidor.', codigo: 'interno' });
};

/** Identificador de ruta: entero positivo de 32 bits; en otro caso 400 (nunca llega a SQL). */
export function idParam(req: { params: Record<string, string> }, k = 'id'): number {
  const s = req.params[k];
  if (!/^\d{1,10}$/.test(s ?? '') || Number(s) < 1 || Number(s) > 2147483647) throw bad('Identificador inválido.');
  return Number(s);
}
