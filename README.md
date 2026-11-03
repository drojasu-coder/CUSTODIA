# Custodia Digital — Sistema de Cadena de Custodia de Evidencia Digital

Prototipo académico (UMG · Análisis de Sistemas 2). **Todos los datos son ficticios**; las firmas son simuladas y no tienen valor jurídico ni pericial.

Implementa el mockup `index.html` como aplicación real de tres capas:

| Capa | Tecnología |
|---|---|
| Presentación | React 18 + Vite + TypeScript + react-router (CSS del mockup sin cambios) |
| Lógica de negocio | Node 22 + Express 5 + TypeScript, zod, JWT + bcrypt, multer, helmet, rate-limit |
| Datos | PostgreSQL 16 (SQL parametrizado con `pg`), archivos en PostgreSQL (BYTEA) o disco (`STORAGE_DRIVER=local`) |

## Puesta en marcha

### Base de datos en Docker + app local (lo más simple)
```bash
docker compose up -d                 # PostgreSQL 16 con el esquema ya aplicado (puerto 5432)
cd backend && npm install && npm run seed && npm run dev      # API en :3000 (datos de demostración)
cd ../frontend && npm install && npm run dev                  # interfaz en :5173
```
No requiere configurar nada: la API ya apunta a `postgresql://custodia:custodia@localhost:5432/custodia`.
Cuentas: `supervisor@custodia.demo`, `recolector@`, `custodio@`, `analista@`, `auditor@`, `administrador@`, `reportante@` (contraseña `Demo123!` solo en desarrollo).
Empezar de cero: `docker compose down -v`.

### Todo en Docker (API + interfaz + base)
```bash
cp .env.example .env     # defina DB_PASSWORD y JWT_SECRET
docker compose -f docker-compose.full.yml up --build -d
docker compose -f docker-compose.full.yml run --rm api node dist/seed.js
```
Interfaz en http://localhost:8080.

Pruebas (usan una base cuyo nombre **termina en `_test`**, que se recrea): 
`TEST_DATABASE_URL=postgresql://.../custodia_test npm test` (en `backend/`).
Reiniciar la demo: `npm run db:reset` (recrea esquema y datos; no disponible en producción).

## Despliegue en Render (un único Web Service Node)
- Blueprint: `render.yaml` (Web Service + PostgreSQL). Manual: Build `npm run build` · Start `npm start` · Health check `/api/salud`.
- Variables: `DATABASE_URL`, `JWT_SECRET` (≥32), `NODE_ENV=production`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥12). Opcionales: `SEED_DEMO`, `DEMO_PASSWORD`, `STORAGE_MAX_KB`, `STORAGE_QUOTA_MB`, `DB_SSL`.
- Al arrancar: crea el esquema si falta, aplica migraciones aditivas (`db/002_*.sql`), crea el administrador inicial si no existe y sirve `frontend/dist` + `/api` en el mismo dominio.
- Archivos: se guardan en PostgreSQL (`archivos_contenido`, BYTEA, solo inserción) porque el disco de Render es efímero. En producción las cuentas de demostración nunca usan `Demo123!`.
- Si el puerto 5432 local está ocupado: `DB_PORT=5433 docker compose up -d` y `DATABASE_URL=postgresql://custodia:custodia@localhost:5433/custodia`.

## Reglas clave y dónde se aplican
- **Hash inicial inmutable, historiales de solo inserción, sin borrado** — triggers en `db/schema.sql` (errores `CD001`/`CD002`), válidos incluso si alguien salta la API.
- **Bitácora con hash encadenado** — cada registro incluye el hash del anterior; `GET /api/auditoria/verificar-cadena` detecta alteraciones.
- **Permisos por rol y por objeto** — matriz en `rol_permiso`; visibilidad por caso/evidencia con `puede_ver_caso()` / `puede_ver_evidencia()`.
- **Cierre de caso bloqueado** con alertas, integridad sin resolver, transferencias o solicitudes pendientes (RN-09, RN-24).
- **Transferencia**: entrega → autorización del Supervisor (no la propia) → recepción por el receptor asignado; un único custodio actual.
- **Análisis solo sobre copias autorizadas**, vigentes y aprobadas; el original no se entrega al analista.
- **Alertas**: discrepancia → Supervisor revisa → una verificación posterior coincidente la resuelve.

## Decisiones y límites conocidos
- Se usa `pg` con SQL explícito (no ORM) para que las reglas vivan en la base de datos.
- Los tipos de evidencia son una tabla (el Administrador puede agregar), no un enum.
- El Auditor no descarga originales (la matriz de permisos no se lo otorga).
- El cierre de un caso archiva sus evidencias; un caso cerrado no se reabre.
- Reportes: JSON/CSV y PDF mediante «Imprimir» del navegador.
- La cadena de hashes detecta alteraciones pero no la eliminación de los últimos registros: resguarde el «último hash» fuera de la base.
- Endurecimiento opcional: `db/app_role.sql` crea un rol sin DDL/TRUNCATE/DELETE para la aplicación.
- Almacenamiento de archivos en disco local: en producción real use almacenamiento WORM/objeto con respaldo cifrado.
