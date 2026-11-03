import { createApp } from './app';
import { bootstrapAdmin } from './bootstrap';
import { config } from './config';
import { migrate } from './migrate';
import { seed } from './seed';

(async () => {
  if (await migrate()) console.log('Esquema creado.');
  // Datos ficticios de demostración solo si se piden explícitamente (SEED_DEMO=true) y la base está vacía.
  if (process.env.SEED_DEMO === 'true' && await seed()) console.log('Datos de demostración ficticios cargados.');
  const adm = await bootstrapAdmin();
  if (adm === 'creado') console.log('Administrador inicial creado desde ADMIN_EMAIL.');
  createApp().listen(config.port, '0.0.0.0', () => console.log(`API de Cadena de Custodia escuchando en el puerto ${config.port}`));
})().catch(e => { console.error(e); process.exit(1); });
