-- Endurecimiento opcional (RNF de seguridad): rol de aplicación con privilegios mínimos.
-- Ejecutar como propietario DESPUÉS de crear el esquema, y usar este rol en DATABASE_URL.
-- Sin DDL, sin TRUNCATE y sin DELETE: el historial queda protegido también por permisos,
-- además de los triggers del esquema.
CREATE ROLE custodia_app LOGIN PASSWORD 'cambie_esta_clave';
GRANT CONNECT ON DATABASE custodia TO custodia_app;
GRANT USAGE ON SCHEMA public TO custodia_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO custodia_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO custodia_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO custodia_app;
-- tablas de catálogo/configuración que sí se administran
GRANT DELETE ON configuracion TO custodia_app;
