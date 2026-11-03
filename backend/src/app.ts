import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authenticate } from './auth';
import { config } from './config';
import { pool } from './db';
import { errorHandler, HttpError } from './errors';
import { adminRouter } from './routes/admin';
import { alertasRouter } from './routes/alertas';
import { analisisRouter } from './routes/analisis';
import { auditoriaRouter } from './routes/auditoria';
import { authRouter } from './routes/auth';
import { casosRouter } from './routes/casos';
import { catalogosRouter } from './routes/catalogos';
import { evidenciasRouter } from './routes/evidencias';
import { panelRouter } from './routes/panel';
import { reportesRouter } from './routes/reportes';
import { solicitudesRouter } from './routes/solicitudes';
import { transferenciasRouter } from './routes/transferencias';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'] } },
  }));
  app.use(cors({ origin: config.corsOrigin.split(','), exposedHeaders: ['X-SHA256', 'Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/salud', async (_req, res) => {
    try { await pool.query('select 1'); res.json({ ok: true, db: 'ok' }); }
    catch { res.status(503).json({ ok: false, db: 'sin_conexion' }); }
  });
  // Límite general por IP (holgado para uso normal; frena barridos automatizados de la API).
  app.use('/api', rateLimit({ windowMs: 5 * 60 * 1000, limit: config.isProd ? 1500 : 100000, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espere unos minutos.', codigo: 'limite' } }));
  app.use('/api/auth', authRouter);
  const api = express.Router();
  api.use(authenticate);
  api.use('/panel', panelRouter);
  api.use('/casos', casosRouter);
  api.use('/evidencias', evidenciasRouter);
  api.use('/transferencias', transferenciasRouter);
  api.use('/solicitudes', solicitudesRouter);
  api.use('/analisis', analisisRouter);
  api.use('/alertas', alertasRouter);
  api.use('/catalogos', catalogosRouter);
  api.use('/auditoria', auditoriaRouter);
  api.use('/reportes', reportesRouter);
  api.use('/admin', adminRouter);
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.', 'no_encontrado')));

  // Frontend compilado en el mismo dominio (producción). /api nunca llega aquí.
  const index = path.join(config.frontendDist, 'index.html');
  if (fs.existsSync(index)) {
    app.use('/assets', express.static(path.join(config.frontendDist, 'assets'), { immutable: true, maxAge: '1y' }),
      (_req: express.Request, res: express.Response) => { res.status(404).end(); });
    app.use(express.static(config.frontendDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) return next();
      res.set('Cache-Control', 'no-cache').sendFile(index);
    });
  }
  app.use(errorHandler);
  return app;
}
