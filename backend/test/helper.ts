import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/custodia_test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'custodia-test-'));
if (!/_test(\?|$)/.test(process.env.DATABASE_URL)) throw new Error('Las pruebas solo corren contra una base cuyo nombre termina en _test.');

import request from 'supertest';

export async function setup() {
  const { pool } = await import('../src/db');
  await pool.query('drop schema public cascade; create schema public;');
  const { migrate } = await import('../src/migrate');
  const { seed } = await import('../src/seed');
  await migrate(); await seed();
  const { createApp } = await import('../src/app');
  const app = createApp();
  const tokens: Record<string, string> = {};
  const as = async (u: string, pass = 'Demo123!') => {
    if (!tokens[u]) { const r = await request(app).post('/api/auth/login').send({ usuario: u, contrasena: pass }); tokens[u] = r.body.token; }
    return { get: (p: string) => request(app).get(p).set('Authorization', 'Bearer ' + tokens[u]),
             post: (p: string) => request(app).post(p).set('Authorization', 'Bearer ' + tokens[u]),
             patch: (p: string) => request(app).patch(p).set('Authorization', 'Bearer ' + tokens[u]),
             put: (p: string) => request(app).put(p).set('Authorization', 'Bearer ' + tokens[u]) };
  };
  return { app, pool, as, request };
}
