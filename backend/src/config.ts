import 'dotenv/config';
import path from 'node:path';

const env = process.env;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export const config = {
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? 'postgresql://custodia:custodia@localhost:5432/custodia',
  /** DB_SSL=true para conexiones externas que exigen TLS (p. ej. la URL externa de Render). */
  dbSsl: env.DB_SSL === 'true',
  jwtSecret: env.JWT_SECRET ?? 'cambiar-en-produccion-secreto-academico',
  jwtExpires: env.JWT_EXPIRES ?? '8h',
  storageDir: path.resolve(env.STORAGE_DIR ?? path.join(__dirname, '..', '..', 'storage')),
  /** "db" (PostgreSQL BYTEA, por defecto) o "local" (disco en STORAGE_DIR). */
  storageDriver: (env.STORAGE_DRIVER === 'local' ? 'local' : 'db') as 'db' | 'local',
  /** Límite duro por archivo (KB) y cuota total de archivos en la base (MB). */
  storageMaxKb: num(env.STORAGE_MAX_KB, 5120),
  storageQuotaMb: num(env.STORAGE_QUOTA_MB, 300),
  /** Carpeta del frontend compilado (se sirve en el mismo dominio que /api si existe). */
  frontendDist: path.resolve(env.FRONTEND_DIST ?? path.join(__dirname, '..', '..', 'frontend', 'dist')),
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  isProd: env.NODE_ENV === 'production',
};

if (config.isProd && (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('cambiar-en-produccion'))) {
  throw new Error('JWT_SECRET debe definirse con al menos 32 caracteres en producción.');
}
if (config.isProd && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL es obligatoria en producción.');
}
