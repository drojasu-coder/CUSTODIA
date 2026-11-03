import { Router } from 'express';
import { requirePermission, hasPerm } from '../auth';
import { one, pool, q } from '../db';
import { wrap } from '../errors';
import { pageParams } from '../util';

export const auditoriaRouter = Router();
const TECNICOS = ['Administración', 'Autenticación', 'Seguridad', 'Catálogos'];

export function filtroAuditoria(u: { id: number; permisos: string[] }, query: any) {
  const f = (k: string) => (typeof query[k] === 'string' && query[k].trim() ? query[k].trim() : null);
  const global = hasPerm(u as any, 'ver_auditoria_global'), tecnica = hasPerm(u as any, 'ver_auditoria_tecnica');
  const where = `($1::boolean or ($2::boolean and b.modulo = any($3)) or b.id_usuario=$4)
     and ($5::text is null or b.modulo=$5) and ($6::text is null or b.resultado::text=$6)
     and ($7::text is null or b.accion ilike $7 or b.referencia ilike $7 or b.nombre_hist ilike $7 or b.descripcion ilike $7)
     and ($8::date is null or b.fecha_hora >= $8::date) and ($9::date is null or b.fecha_hora < $9::date + 1)`;
  const params = [global, tecnica && !global, TECNICOS, u.id, f('modulo'), f('resultado'), f('q') ? `%${f('q')}%` : null, f('desde'), f('hasta')];
  return { where, params };
}

auditoriaRouter.get('/', requirePermission('ver_auditoria_global', 'ver_auditoria_tecnica', 'ver_actividad_propia'), wrap(async (req, res) => {
  const { page, size, offset } = pageParams(req.query, 15);
  const { where, params } = filtroAuditoria(req.user!, req.query);
  const total = (await one(pool, `select count(*)::int n from bitacora_auditoria b where ${where}`, params))!.n;
  const items = await q(pool, `select b.id_bitacora, b.codigo, b.nombre_hist as usuario, b.rol_hist as rol, b.modulo, b.accion, b.referencia, b.descripcion, b.resultado, b.direccion_ip, b.fecha_hora, b.id_caso, b.id_evidencia
    from bitacora_auditoria b where ${where} order by b.id_bitacora desc limit $10 offset $11`, [...params, size, offset]);
  const modulos = await q(pool, `select distinct b.modulo from bitacora_auditoria b where ${where} order by 1`, params);
  res.json({ total, page, size, items, modulos: modulos.map(m => m.modulo) });
}));

auditoriaRouter.get('/verificar-cadena', requirePermission('ver_auditoria_global', 'ver_auditoria_tecnica'), wrap(async (_req, res) => {
  const problemas = await q(pool, 'select * from verificar_cadena_bitacora()');
  const cab = await one(pool, 'select id_bitacora, hash_registro from bitacora_auditoria order by id_bitacora desc limit 1');
  const total = (await one(pool, 'select count(*)::int n from bitacora_auditoria'))!.n;
  res.json({ integra: problemas.length === 0, registros: total, problemas, ultimo_hash: cab?.hash_registro ?? null,
    nota: 'El encadenado detecta alteraciones; para detectar eliminaciones al final, resguarde el último hash fuera de la base de datos.' });
}));
