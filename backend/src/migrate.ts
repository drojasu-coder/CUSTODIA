import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db';

const DB_DIR = path.join(__dirname, '..', '..', 'db');
/** Migraciones aditivas e idempotentes, aplicadas en orden en cada arranque. */
const ADITIVAS = ['002_archivos_contenido.sql'];

/** Crea el esquema base si falta y aplica las migraciones aditivas. Devuelve true si creó el esquema. */
export async function migrate(): Promise<boolean> {
  const { rows } = await pool.query(`select to_regclass('public.usuarios') as t`);
  const creado = !rows[0].t;
  if (creado) await pool.query(fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8'));
  for (const f of ADITIVAS) await pool.query(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
  return creado;
}
if (require.main === module) {
  migrate().then(done => { console.log(done ? 'Esquema creado.' : 'El esquema ya existe; migraciones aditivas aplicadas.'); return pool.end(); })
    .catch(e => { console.error(e); process.exit(1); });
}
