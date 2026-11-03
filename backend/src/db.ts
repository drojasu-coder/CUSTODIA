import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10,
  ...(config.dbSsl ? { ssl: { rejectUnauthorized: false } } : {}) });
export type Db = Pool | PoolClient;

export async function q<T extends QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params as any[])).rows;
}
export async function one<T extends QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(db, sql, params))[0];
}
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
