// Reinicia por completo la base (solo desarrollo/demostración). El historial es
// inmutable por triggers, por eso se recrea el esquema en lugar de borrar filas.
import fs from 'node:fs';
import { pool } from './db';
import { migrate } from './migrate';
import { seed } from './seed';
import { config } from './config';

(async () => {
  if (config.isProd) throw new Error('db:reset está deshabilitado en producción.');
  await pool.query('drop schema public cascade; create schema public;');
  fs.rmSync(config.storageDir, { recursive: true, force: true });
  await migrate();
  await seed();
  console.log('Base reiniciada con datos de demostración.');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
