-- Migración aditiva e idempotente (se ejecuta en cada arranque; no altera tablas existentes).
-- Contenido binario de originales y copias autorizadas guardado en PostgreSQL (BYTEA),
-- para entornos sin disco persistente (Render Free). Solo inserción: ni UPDATE, DELETE ni TRUNCATE.
-- archivos_evidencia.ruta_almacenamiento apunta aquí con el prefijo "db:" (p. ej. db:originales/<uuid>).
CREATE TABLE IF NOT EXISTS archivos_contenido (
  id_contenido   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clave          varchar(120) NOT NULL UNIQUE,              -- originales/<uuid>.bin | copias/<uuid>.bin
  contenido      bytea NOT NULL,
  tamano_bytes   bigint NOT NULL CHECK (tamano_bytes = octet_length(contenido)),
  hash_sha256    char(64) NOT NULL,                          -- huella al momento de guardar
  fecha_carga    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'inm_archivos_contenido') THEN
    CREATE TRIGGER inm_archivos_contenido BEFORE UPDATE OR DELETE ON archivos_contenido
      FOR EACH ROW EXECUTE FUNCTION trg_inmutable();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'inmt_archivos_contenido') THEN
    CREATE TRIGGER inmt_archivos_contenido BEFORE TRUNCATE ON archivos_contenido
      FOR EACH STATEMENT EXECUTE FUNCTION trg_inmutable();
  END IF;
END $$;

-- Límite por defecto de adjuntos (solo si falta).
INSERT INTO configuracion (clave, valor) VALUES ('max_adjunto_kb', '5120') ON CONFLICT (clave) DO NOTHING;
