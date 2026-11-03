import type { Request } from 'express';
import { Db, pool, q } from './db';
import { AuthUser, clientIp } from './util';

export interface AuditInput {
  modulo: string; accion: string; referencia?: string; descripcion?: string;
  resultado?: 'exitoso' | 'rechazado' | 'error' | 'critico';
  id_caso?: number | null; id_evidencia?: number | null;
}

export async function audit(db: Db, user: AuthUser | null, req: Request | null, a: AuditInput, fallbackName = 'Sin sesión') {
  await db.query(
    `insert into bitacora_auditoria (id_usuario, nombre_hist, rol_hist, id_caso, id_evidencia, modulo, accion, referencia, descripcion, resultado, direccion_ip)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [user?.id ?? null, user?.nombre ?? fallbackName, user?.rol ?? '—', a.id_caso ?? null, a.id_evidencia ?? null,
     a.modulo, a.accion, a.referencia ?? '', a.descripcion ?? null, a.resultado ?? 'exitoso', req ? clientIp(req) : null]);
}

/** Línea de tiempo de custodia por evidencia (RN-15: solo inserción). */
export async function evento(db: Db, user: AuthUser, ev: { id_evidencia: number; id_caso: number; id_ubicacion?: number | null; hash?: string | null },
                             accion: string, detalle: string) {
  await db.query(
    `insert into eventos_custodia (id_evidencia,id_caso,id_usuario,nombre_usuario_hist,rol_hist,accion,detalle,id_ubicacion,hash_referencia)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ev.id_evidencia, ev.id_caso, user.id, user.nombre, user.rol, accion, detalle, ev.id_ubicacion ?? null, ev.hash ?? null]);
}
export const auditSolo = (user: AuthUser | null, req: Request | null, a: AuditInput) => audit(pool, user, req, a);
export { q };
