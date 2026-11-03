import { one, pool, Db, q } from './db';
import { forbidden, notFound, conflict } from './errors';
import type { AuthUser } from './util';

export const codigoNuevo = async (db: Db, prefijo: string) =>
  (await one<{ c: string }>(db, 'select siguiente_codigo($1) as c', [prefijo]))!.c;

export async function casoVisible(user: AuthUser, id: number, db: Db = pool) {
  const c = await one(db, `select c.*, (select nombres||' '||apellidos from usuarios where id_usuario=c.id_reportante) as reportante,
        (select nombres||' '||apellidos from usuarios where id_usuario=c.id_responsable) as responsable
      from casos c where id_caso=$1`, [id]);
  if (!c) throw notFound('Caso no encontrado.');
  const ok = (await one(db, 'select puede_ver_caso($1,$2,$3) as ok', [user.id, user.rol, id]))!.ok;
  if (!ok) throw forbidden('No tiene acceso a este caso.');
  return c;
}

export async function evidenciaVisible(user: AuthUser, id: number, db: Db = pool) {
  const e = await one(db, `select e.*, t.nombre as tipo, u.nombre as ubicacion, c.codigo_caso, c.estado as estado_caso, c.titulo as titulo_caso,
        (select nombres||' '||apellidos from usuarios where id_usuario=e.id_custodio_actual) as custodio,
        (select nombres||' '||apellidos from usuarios where id_usuario=e.id_recolector) as recolector
      from evidencias e join tipos_evidencia t using (id_tipo) join ubicaciones u using (id_ubicacion) join casos c using (id_caso)
      where e.id_evidencia=$1`, [id]);
  if (!e) throw notFound('Evidencia no encontrada.');
  const ok = (await one(db, 'select puede_ver_evidencia($1,$2,$3) as ok', [user.id, user.rol, id]))!.ok;
  if (!ok) throw forbidden('No tiene acceso a esta evidencia.');
  return e;
}

export function casoAbierto(c: { estado: string }) {
  if (['cerrado', 'archivado'].includes(c.estado)) throw conflict('El caso está cerrado: ya no admite cambios.');
}

/** Marca como vencidas las solicitudes aprobadas cuya vigencia terminó. */
export const expirarSolicitudes = (db: Db = pool) =>
  q(db, `update solicitudes_acceso set estado='vencida' where estado='aprobada' and fecha_vencimiento < hoy_gt()`);
