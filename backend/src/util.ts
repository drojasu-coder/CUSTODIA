import crypto from 'node:crypto';
import type { Request } from 'express';

export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
export const isHash = (s: string) => /^[a-f0-9]{64}$/i.test(s);
export const clientIp = (req: Request) => (req.ip ?? req.socket?.remoteAddress ?? '').replace('::ffff:', '').slice(0, 45) || null;

export interface AuthUser {
  id: number; codigo: string; nombre: string; rol: string; correo: string; unidad: string; permisos: string[];
}
export const nombreCompleto = (u: { nombres: string; apellidos: string }) => `${u.nombres} ${u.apellidos}`.trim();

export function pageParams(q: any, def = 10, max = 100) {
  const page = Math.max(1, Number(q.page) || 1);
  const size = Math.min(max, Math.max(1, Number(q.size) || def));
  return { page, size, offset: (page - 1) * size };
}
/** Escapa un valor para CSV (comillas dobles y neutraliza fórmulas de hoja de cálculo). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '﻿';
  const cols = Object.keys(rows[0]);
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n');
}
