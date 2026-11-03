-- =====================================================================
-- SISTEMA DE CADENA DE CUSTODIA DE EVIDENCIA DIGITAL
-- Esquema PostgreSQL 16 · basado en el modelo entidad-relación (DBML)
-- de la Fase 3, con las extensiones que exige el prototipo
-- (ubicaciones, tipos de evidencia, copias autorizadas, línea de tiempo).
--
-- Las reglas de inmutabilidad viven AQUÍ, en la base de datos, y no solo
-- en la API: RN-05, RN-15, RN-22, RNF-02, CP-20, CP-21.
-- Datos de uso académico: toda la información es ficticia.
-- =====================================================================

SET client_min_messages = warning;

-- ---------------------------------------------------------------------
-- ENUMERACIONES
-- ---------------------------------------------------------------------
CREATE TYPE case_status AS ENUM ('abierto','en_investigacion','suspendido','cerrado','archivado');

-- Ciclo de vida de la evidencia. 'registrada', 'recolectada', 'en_analisis' y
-- 'verificada' se conservan del modelo original; el estado operativo usa
-- en_custodia / transferida / con_alerta / archivada y la integridad se
-- controla por separado (integrity_status).
CREATE TYPE evidence_status AS ENUM ('registrada','recolectada','en_custodia','transferida','en_analisis','verificada','con_alerta','archivada');
CREATE TYPE integrity_status AS ENUM ('sin_verificar','verificada','no_coincide','en_revision');

CREATE TYPE hash_record_type AS ENUM ('inicial','verificacion');
CREATE TYPE verification_result AS ENUM ('coincide','no_coincide','no_aplica');
CREATE TYPE verification_mode AS ENUM ('almacenado','externo','simulacion','inicial');

-- pendiente = pendiente de autorización · autorizada = pendiente de recepción
-- recibida = completada. La entrega se registra al crear la transferencia.
CREATE TYPE transfer_status AS ENUM ('pendiente','autorizada','rechazada','recibida','cancelada');

CREATE TYPE access_request_status AS ENUM ('pendiente','aprobada','rechazada','vencida','cerrada');
CREATE TYPE access_scope AS ENUM ('copia_trabajo','metadatos');
CREATE TYPE alert_level AS ENUM ('informativa','advertencia','critica');
CREATE TYPE alert_status AS ENUM ('pendiente','en_revision','resuelta','descartada');
CREATE TYPE audit_result AS ENUM ('exitoso','rechazado','error','critico');
CREATE TYPE location_type AS ENUM ('fisica','logica');

-- ---------------------------------------------------------------------
-- CONTADORES DE CÓDIGOS LEGIBLES (CAS-2026-001, EVI-2026-014, ...)
-- ---------------------------------------------------------------------
CREATE TABLE contadores (
  prefijo varchar(10) NOT NULL,
  anio    int NOT NULL,
  valor   int NOT NULL DEFAULT 0,
  PRIMARY KEY (prefijo, anio)
);

CREATE FUNCTION hoy_gt() RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE 'America/Guatemala')::date $$;

CREATE FUNCTION siguiente_codigo(p_prefijo varchar) RETURNS varchar
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  y int := extract(year FROM (now() AT TIME ZONE 'America/Guatemala'))::int;
  v int;
BEGIN
  INSERT INTO contadores (prefijo, anio, valor) VALUES (p_prefijo, y, 1)
  ON CONFLICT (prefijo, anio) DO UPDATE SET valor = contadores.valor + 1
  RETURNING valor INTO v;
  RETURN p_prefijo || '-' || y || '-' || lpad(v::text, 3, '0');
END $$;

-- ---------------------------------------------------------------------
-- SEGURIDAD Y ACCESO
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  id_rol      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre      varchar(50)  NOT NULL UNIQUE,
  descripcion varchar(250) NOT NULL,
  activo      boolean NOT NULL DEFAULT true
);

CREATE TABLE permisos (
  id_permiso  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo      varchar(60)  NOT NULL UNIQUE,
  nombre      varchar(100) NOT NULL,
  descripcion varchar(250) NOT NULL   -- condición adicional que valida la API
);

CREATE TABLE rol_permiso (
  id_rol           int NOT NULL REFERENCES roles(id_rol),
  id_permiso       int NOT NULL REFERENCES permisos(id_permiso),
  fecha_asignacion timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_rol, id_permiso)
);

CREATE TABLE usuarios (
  id_usuario      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo          varchar(20)  NOT NULL UNIQUE,            -- USR-01
  id_rol          int NOT NULL REFERENCES roles(id_rol),
  nombres         varchar(80)  NOT NULL,
  apellidos       varchar(80)  NOT NULL,
  correo          varchar(120) NOT NULL,
  nombre_usuario  varchar(50)  NOT NULL,
  unidad          varchar(150) NOT NULL DEFAULT '',
  contrasena_hash varchar(255) NOT NULL,                   -- bcrypt; nunca texto visible
  activo          boolean NOT NULL DEFAULT true,
  fecha_creacion  timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso   timestamptz
);
CREATE UNIQUE INDEX usuarios_correo_uq ON usuarios (lower(correo));
CREATE UNIQUE INDEX usuarios_nombre_usuario_uq ON usuarios (lower(nombre_usuario));

-- ---------------------------------------------------------------------
-- CATÁLOGOS
-- ---------------------------------------------------------------------
CREATE TABLE ubicaciones (
  id_ubicacion int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo       varchar(20)  NOT NULL UNIQUE,               -- LOC-001
  nombre       varchar(180) NOT NULL,
  tipo         location_type NOT NULL,
  capacidad    int NOT NULL CHECK (capacidad BETWEEN 1 AND 100000),
  activo       boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ubicaciones_nombre_uq ON ubicaciones (lower(nombre));

CREATE TABLE tipos_evidencia (
  id_tipo int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre  varchar(80) NOT NULL,
  activo  boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX tipos_evidencia_nombre_uq ON tipos_evidencia (lower(nombre));

CREATE TABLE configuracion (
  clave varchar(60) PRIMARY KEY,
  valor text NOT NULL
);

-- ---------------------------------------------------------------------
-- CASOS
-- ---------------------------------------------------------------------
CREATE TABLE casos (
  id_caso              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo_caso          varchar(30)  NOT NULL UNIQUE,       -- CAS-2026-001
  titulo               varchar(180) NOT NULL,
  descripcion          text NOT NULL,
  tipo_incidente       varchar(80)  NOT NULL,
  lugar                varchar(180) NOT NULL,
  fecha_reporte        timestamptz NOT NULL DEFAULT now(),
  id_reportante        int NOT NULL REFERENCES usuarios(id_usuario),
  id_responsable       int REFERENCES usuarios(id_usuario), -- Supervisor que da seguimiento
  id_supervisor_cierre int REFERENCES usuarios(id_usuario),
  estado               case_status NOT NULL DEFAULT 'abierto',
  fecha_cierre         timestamptz,
  motivo_cierre        text
);

CREATE TABLE caso_asignaciones (
  id_caso    int NOT NULL REFERENCES casos(id_caso),
  id_usuario int NOT NULL REFERENCES usuarios(id_usuario),
  fecha      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_caso, id_usuario)
);

-- ---------------------------------------------------------------------
-- EVIDENCIAS
-- ---------------------------------------------------------------------
CREATE TABLE evidencias (
  id_evidencia            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_caso                 int NOT NULL REFERENCES casos(id_caso),
  codigo_unico            varchar(40)  NOT NULL UNIQUE,    -- EVI-2026-001
  codigo_qr               varchar(200) NOT NULL UNIQUE,
  id_tipo                 int NOT NULL REFERENCES tipos_evidencia(id_tipo),
  nombre_referencia       varchar(150) NOT NULL,
  descripcion             text NOT NULL,
  marca                   varchar(80),
  modelo                  varchar(80),
  numero_serie            varchar(100),
  capacidad_almacenamiento varchar(50),
  estado_fisico           varchar(100),
  lugar_recoleccion       varchar(180) NOT NULL,
  fecha_recoleccion       timestamptz NOT NULL,
  id_recolector           int NOT NULL REFERENCES usuarios(id_usuario),
  id_custodio_actual      int NOT NULL REFERENCES usuarios(id_usuario),
  id_ubicacion            int NOT NULL REFERENCES ubicaciones(id_ubicacion),
  estado                  evidence_status NOT NULL DEFAULT 'en_custodia',
  integridad              integrity_status NOT NULL DEFAULT 'sin_verificar',
  hash_inicial            char(64) NOT NULL,
  hash_ultima_verificacion varchar(128),
  observaciones           text,
  fecha_registro          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidencias_caso_idx ON evidencias (id_caso);
CREATE INDEX evidencias_custodio_idx ON evidencias (id_custodio_actual);
CREATE INDEX evidencias_ubicacion_idx ON evidencias (id_ubicacion);

-- ---------------------------------------------------------------------
-- SOLICITUDES, COPIAS AUTORIZADAS Y ARCHIVOS
-- ---------------------------------------------------------------------
CREATE TABLE solicitudes_acceso (
  id_solicitud          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo                varchar(30) NOT NULL UNIQUE,       -- SOL-2026-001
  id_evidencia          int NOT NULL REFERENCES evidencias(id_evidencia),
  id_solicitante        int NOT NULL REFERENCES usuarios(id_usuario),
  id_supervisor         int REFERENCES usuarios(id_usuario),
  alcance               access_scope NOT NULL,
  fecha_solicitud       timestamptz NOT NULL DEFAULT now(),
  fecha_respuesta       timestamptz,
  motivo                varchar(250) NOT NULL,
  estado                access_request_status NOT NULL DEFAULT 'pendiente',
  fecha_vencimiento     date NOT NULL,
  observaciones_supervisor text
);
CREATE INDEX solicitudes_evidencia_idx ON solicitudes_acceso (id_evidencia);
CREATE INDEX solicitudes_solicitante_idx ON solicitudes_acceso (id_solicitante);

CREATE TABLE copias_autorizadas (
  id_copia       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo         varchar(60) NOT NULL UNIQUE,              -- COPY-EVI-2026-015-001
  id_evidencia   int NOT NULL REFERENCES evidencias(id_evidencia),
  id_solicitud   int NOT NULL UNIQUE REFERENCES solicitudes_acceso(id_solicitud),
  id_propietario int NOT NULL REFERENCES usuarios(id_usuario),
  hash_sha256    char(64) NOT NULL,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE archivos_evidencia (
  id_archivo          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo              varchar(80) NOT NULL UNIQUE,         -- FIL-EVI-2026-014
  id_evidencia        int NOT NULL REFERENCES evidencias(id_evidencia),
  id_copia            int REFERENCES copias_autorizadas(id_copia),
  nombre_original     varchar(255) NOT NULL,
  tipo_mime           varchar(100),
  extension           varchar(20),
  tamano_bytes        bigint NOT NULL,
  ruta_almacenamiento varchar(255) NOT NULL,               -- relativa al repositorio
  hash_sha256         char(64) NOT NULL,
  fecha_carga         timestamptz NOT NULL DEFAULT now(),
  id_usuario_carga    int NOT NULL REFERENCES usuarios(id_usuario),
  es_archivo_original boolean NOT NULL DEFAULT true,
  es_demo             boolean NOT NULL DEFAULT false,
  CHECK (es_archivo_original = (id_copia IS NULL))
);
CREATE INDEX archivos_evidencia_idx ON archivos_evidencia (id_evidencia);

-- ---------------------------------------------------------------------
-- INTEGRIDAD Y HASH
-- ---------------------------------------------------------------------
CREATE TABLE registros_hash (
  id_registro_hash int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo           varchar(30) UNIQUE,                     -- VER-2026-001 (solo verificaciones)
  id_evidencia     int NOT NULL REFERENCES evidencias(id_evidencia),
  tipo_registro    hash_record_type NOT NULL,
  algoritmo        varchar(30) NOT NULL DEFAULT 'SHA-256',
  valor_hash       varchar(128) NOT NULL,
  hash_esperado    varchar(128),
  modo             verification_mode NOT NULL,
  fecha_calculo    timestamptz NOT NULL DEFAULT now(),
  id_usuario       int NOT NULL REFERENCES usuarios(id_usuario),
  resultado        verification_result NOT NULL DEFAULT 'no_aplica',
  observaciones    text
);
CREATE INDEX registros_hash_evidencia_idx ON registros_hash (id_evidencia);

CREATE TABLE alertas_integridad (
  id_alerta            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo               varchar(30) NOT NULL UNIQUE,        -- ALT-2026-001
  id_evidencia         int NOT NULL REFERENCES evidencias(id_evidencia),
  id_registro_hash     int NOT NULL REFERENCES registros_hash(id_registro_hash),
  nivel                alert_level NOT NULL DEFAULT 'critica',
  estado               alert_status NOT NULL DEFAULT 'pendiente',
  descripcion          text NOT NULL,
  hash_esperado        varchar(128) NOT NULL,
  hash_observado       varchar(128) NOT NULL,
  fecha_generacion     timestamptz NOT NULL DEFAULT now(),
  id_supervisor_revisor int REFERENCES usuarios(id_usuario),
  fecha_revision       timestamptz,
  resolucion           text,
  fecha_resolucion     timestamptz
);
CREATE INDEX alertas_evidencia_idx ON alertas_integridad (id_evidencia);

CREATE TABLE alertas_historial (
  id_historial int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_alerta    int NOT NULL REFERENCES alertas_integridad(id_alerta),
  fecha        timestamptz NOT NULL DEFAULT now(),
  id_usuario   int NOT NULL REFERENCES usuarios(id_usuario),
  accion       varchar(80) NOT NULL,
  notas        text NOT NULL
);

-- ---------------------------------------------------------------------
-- CUSTODIA Y TRANSFERENCIAS
-- ---------------------------------------------------------------------
CREATE TABLE transferencias_custodia (
  id_transferencia  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo            varchar(30) NOT NULL UNIQUE,           -- TRF-2026-001
  id_evidencia      int NOT NULL REFERENCES evidencias(id_evidencia),
  id_entregante     int NOT NULL REFERENCES usuarios(id_usuario),
  id_receptor       int NOT NULL REFERENCES usuarios(id_usuario),
  id_autorizador    int REFERENCES usuarios(id_usuario),
  id_ubicacion_destino int NOT NULL REFERENCES ubicaciones(id_ubicacion),
  fecha_solicitud   timestamptz NOT NULL DEFAULT now(),
  fecha_entrega     timestamptz NOT NULL DEFAULT now(),
  fecha_autorizacion timestamptz,
  fecha_recepcion   timestamptz,
  motivo            varchar(250) NOT NULL,
  estado            transfer_status NOT NULL DEFAULT 'pendiente',
  firma_entregante  varchar(255),                          -- firma SIMULADA, sin efectos jurídicos
  firma_receptor    varchar(255),                          -- firma SIMULADA, sin efectos jurídicos
  observaciones     text,
  CHECK (id_entregante <> id_receptor)
);
CREATE INDEX transferencias_evidencia_idx ON transferencias_custodia (id_evidencia);
-- Una sola transferencia activa por evidencia.
CREATE UNIQUE INDEX transferencia_activa_uq ON transferencias_custodia (id_evidencia)
  WHERE estado IN ('pendiente','autorizada');

CREATE TABLE registros_custodia (
  id_custodia       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_evidencia      int NOT NULL REFERENCES evidencias(id_evidencia),
  id_custodio       int NOT NULL REFERENCES usuarios(id_usuario),
  id_ubicacion      int NOT NULL REFERENCES ubicaciones(id_ubicacion),
  ubicacion         varchar(180) NOT NULL,                 -- nombre vigente al momento del registro
  id_transferencia  int REFERENCES transferencias_custodia(id_transferencia),
  fecha_inicio      timestamptz NOT NULL DEFAULT now(),
  fecha_fin         timestamptz,
  es_custodia_actual boolean NOT NULL DEFAULT true,
  observaciones     text
);
-- RN-11: un único custodio actual por evidencia.
CREATE UNIQUE INDEX custodia_actual_uq ON registros_custodia (id_evidencia) WHERE es_custodia_actual;

-- ---------------------------------------------------------------------
-- ANÁLISIS FORENSE
-- ---------------------------------------------------------------------
CREATE TABLE analisis_forenses (
  id_analisis        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo             varchar(30) NOT NULL UNIQUE,          -- ANA-2026-001
  id_evidencia       int NOT NULL REFERENCES evidencias(id_evidencia),
  id_solicitud       int NOT NULL UNIQUE REFERENCES solicitudes_acceso(id_solicitud),
  id_copia           int NOT NULL REFERENCES copias_autorizadas(id_copia),
  id_analista        int NOT NULL REFERENCES usuarios(id_usuario),
  proposito          varchar(250) NOT NULL,
  actividad_realizada text NOT NULL,
  herramientas       varchar(250) NOT NULL,
  resultado          text NOT NULL,                        -- hallazgos
  conclusiones       text NOT NULL,
  fecha_inicio       date NOT NULL,
  fecha_fin          date NOT NULL,
  fecha_registro     timestamptz NOT NULL DEFAULT now(),
  observaciones      text,
  CHECK (fecha_inicio <= fecha_fin)
);

CREATE TABLE analisis_notas (
  id_nota     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_analisis int NOT NULL REFERENCES analisis_forenses(id_analisis),
  id_usuario  int NOT NULL REFERENCES usuarios(id_usuario),
  texto       text NOT NULL,
  fecha       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- LÍNEA DE TIEMPO Y AUDITORÍA
-- ---------------------------------------------------------------------
CREATE TABLE eventos_custodia (
  id_evento     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_evidencia  int NOT NULL REFERENCES evidencias(id_evidencia),
  id_caso       int NOT NULL REFERENCES casos(id_caso),
  id_usuario    int NOT NULL REFERENCES usuarios(id_usuario),
  nombre_usuario_hist varchar(200) NOT NULL,
  rol_hist      varchar(50) NOT NULL,
  accion        varchar(120) NOT NULL,
  detalle       text NOT NULL,
  id_ubicacion  int REFERENCES ubicaciones(id_ubicacion),
  hash_referencia varchar(128),
  fecha         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eventos_evidencia_idx ON eventos_custodia (id_evidencia, fecha);

CREATE SEQUENCE bitacora_seq;

CREATE TABLE bitacora_auditoria (
  id_bitacora  int PRIMARY KEY,                            -- asignado por el trigger de cadena
  codigo       varchar(30) UNIQUE,                         -- AUD-2026-001
  id_usuario   int REFERENCES usuarios(id_usuario),        -- NULL: intento sin sesión
  nombre_hist  varchar(200) NOT NULL,
  rol_hist     varchar(50)  NOT NULL,
  id_caso      int REFERENCES casos(id_caso),
  id_evidencia int REFERENCES evidencias(id_evidencia),
  modulo       varchar(80)  NOT NULL,
  accion       varchar(120) NOT NULL,
  referencia   varchar(120) NOT NULL DEFAULT '',
  descripcion  text,
  resultado    audit_result NOT NULL,
  direccion_ip varchar(45),
  fecha_hora   timestamptz NOT NULL DEFAULT now(),
  hash_previo  char(64) NOT NULL,
  hash_registro char(64) NOT NULL UNIQUE
);
CREATE INDEX bitacora_fecha_idx ON bitacora_auditoria (fecha_hora DESC);
CREATE INDEX bitacora_usuario_idx ON bitacora_auditoria (id_usuario);

-- Hash encadenado: cada evento incorpora el hash del anterior. Si alguien altera
-- o intercala un registro, verificar_cadena_bitacora() lo detecta.
CREATE FUNCTION hash_bitacora(
  p_prev text, p_codigo text, p_usuario int, p_nombre text, p_rol text, p_caso int, p_evid int,
  p_modulo text, p_accion text, p_ref text, p_desc text, p_res text, p_ip text, p_fecha timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    p_prev, p_codigo, coalesce(p_usuario::text,''), coalesce(p_nombre,''), coalesce(p_rol,''),
    coalesce(p_caso::text,''), coalesce(p_evid::text,''), p_modulo, p_accion, coalesce(p_ref,''),
    coalesce(p_desc,''), p_res, coalesce(p_ip,''),
    to_char(p_fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ), 'UTF8')), 'hex')
$$;

CREATE FUNCTION trg_bitacora_cadena() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(884422);   -- serializa la cadena
  SELECT hash_registro INTO prev FROM bitacora_auditoria ORDER BY id_bitacora DESC LIMIT 1;
  NEW.hash_previo  := coalesce(prev, repeat('0', 64));
  NEW.id_bitacora  := nextval('bitacora_seq');
  NEW.codigo       := siguiente_codigo('AUD');
  NEW.hash_registro := hash_bitacora(NEW.hash_previo, NEW.codigo, NEW.id_usuario, NEW.nombre_hist,
    NEW.rol_hist, NEW.id_caso, NEW.id_evidencia, NEW.modulo, NEW.accion, NEW.referencia,
    NEW.descripcion, NEW.resultado::text, NEW.direccion_ip, NEW.fecha_hora);
  RETURN NEW;
END $$;

CREATE TRIGGER bitacora_cadena BEFORE INSERT ON bitacora_auditoria
  FOR EACH ROW EXECUTE FUNCTION trg_bitacora_cadena();

CREATE FUNCTION verificar_cadena_bitacora()
RETURNS TABLE (codigo text, motivo text) LANGUAGE plpgsql STABLE AS $$
DECLARE r record; prev text := repeat('0', 64);
BEGIN
  FOR r IN SELECT * FROM bitacora_auditoria ORDER BY id_bitacora LOOP
    IF r.hash_previo <> prev THEN
      codigo := r.codigo; motivo := 'El enlace con el registro anterior está roto'; RETURN NEXT;
    END IF;
    IF r.hash_registro <> hash_bitacora(r.hash_previo, r.codigo, r.id_usuario, r.nombre_hist,
         r.rol_hist, r.id_caso, r.id_evidencia, r.modulo, r.accion, r.referencia,
         r.descripcion, r.resultado::text, r.direccion_ip, r.fecha_hora) THEN
      codigo := r.codigo; motivo := 'El contenido del registro fue alterado'; RETURN NEXT;
    END IF;
    prev := r.hash_registro;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- VISIBILIDAD POR ROL Y OBJETO (misma lógica que el prototipo)
-- ---------------------------------------------------------------------
CREATE FUNCTION solicitud_vigente(p_solicitud int, p_usuario int) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM solicitudes_acceso s
    JOIN copias_autorizadas c ON c.id_solicitud = s.id_solicitud AND c.id_propietario = p_usuario
    WHERE s.id_solicitud = p_solicitud AND s.id_solicitante = p_usuario
      AND s.estado = 'aprobada' AND s.fecha_vencimiento >= hoy_gt())
$$;

CREATE FUNCTION puede_ver_evidencia(p_usuario int, p_rol text, p_evidencia int) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE p_rol
    WHEN 'Supervisor' THEN true
    WHEN 'Auditor' THEN true
    WHEN 'Recolector' THEN EXISTS (SELECT 1 FROM evidencias e WHERE e.id_evidencia = p_evidencia
        AND (e.id_recolector = p_usuario OR e.id_custodio_actual = p_usuario))
    WHEN 'Custodio' THEN EXISTS (SELECT 1 FROM evidencias e WHERE e.id_evidencia = p_evidencia
        AND e.id_custodio_actual = p_usuario)
      OR EXISTS (SELECT 1 FROM transferencias_custodia t WHERE t.id_evidencia = p_evidencia
        AND (t.id_entregante = p_usuario OR t.id_receptor = p_usuario))
    WHEN 'Analista forense' THEN EXISTS (SELECT 1 FROM solicitudes_acceso s
        WHERE s.id_evidencia = p_evidencia AND solicitud_vigente(s.id_solicitud, p_usuario))
    ELSE false END
$$;

CREATE FUNCTION puede_ver_caso(p_usuario int, p_rol text, p_caso int) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE p_rol
    WHEN 'Supervisor' THEN true
    WHEN 'Auditor' THEN true
    WHEN 'Reportante' THEN EXISTS (SELECT 1 FROM casos c WHERE c.id_caso = p_caso AND c.id_reportante = p_usuario)
    WHEN 'Recolector' THEN EXISTS (SELECT 1 FROM casos c WHERE c.id_caso = p_caso AND c.id_reportante = p_usuario)
      OR EXISTS (SELECT 1 FROM caso_asignaciones a WHERE a.id_caso = p_caso AND a.id_usuario = p_usuario)
      OR EXISTS (SELECT 1 FROM evidencias e WHERE e.id_caso = p_caso AND e.id_recolector = p_usuario)
    WHEN 'Analista forense' THEN EXISTS (SELECT 1 FROM solicitudes_acceso s
        JOIN evidencias e ON e.id_evidencia = s.id_evidencia
        WHERE e.id_caso = p_caso AND solicitud_vigente(s.id_solicitud, p_usuario))
    ELSE false END
$$;

-- Pendientes que impiden cerrar un caso (RN-09, RN-24, CP-09, CP-30).
CREATE FUNCTION pendientes_cierre(p_caso int) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM alertas_integridad a JOIN evidencias e USING (id_evidencia)
        WHERE e.id_caso = p_caso AND a.estado IN ('pendiente','en_revision'))
      THEN 'alertas sin resolver' END,
    CASE WHEN EXISTS (SELECT 1 FROM evidencias e WHERE e.id_caso = p_caso
        AND e.integridad IN ('no_coincide','en_revision'))
      THEN 'integridad no resuelta' END,
    CASE WHEN EXISTS (SELECT 1 FROM transferencias_custodia t JOIN evidencias e USING (id_evidencia)
        WHERE e.id_caso = p_caso AND t.estado IN ('pendiente','autorizada'))
      THEN 'transferencias pendientes' END,
    CASE WHEN EXISTS (SELECT 1 FROM solicitudes_acceso s JOIN evidencias e USING (id_evidencia)
        WHERE e.id_caso = p_caso AND s.estado = 'pendiente')
      THEN 'solicitudes pendientes' END
  ], NULL)
$$;

-- ---------------------------------------------------------------------
-- PROTECCIÓN DE HISTORIALES (triggers; aplican incluso al propietario)
-- SQLSTATE CD001 = registro histórico protegido · CD002 = regla de negocio
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro histórico protegido: la tabla % no admite % (RN-15, RN-22).', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'CD001';
END $$;

CREATE FUNCTION trg_sin_borrado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'No se eliminan registros de %: cambie su estado en su lugar (RN-05).', TG_TABLE_NAME
    USING ERRCODE = 'CD001';
END $$;

DO $$
DECLARE t text;
BEGIN
  -- Registros de solo inserción: ni UPDATE, ni DELETE, ni TRUNCATE.
  FOREACH t IN ARRAY ARRAY['bitacora_auditoria','eventos_custodia','registros_hash','analisis_forenses',
                           'analisis_notas','alertas_historial','archivos_evidencia','copias_autorizadas']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_inmutable()', 'inm_'||t, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION trg_inmutable()', 'inmt_'||t, t);
  END LOOP;
  -- Registros que pueden cambiar de estado pero jamás eliminarse.
  FOREACH t IN ARRAY ARRAY['casos','evidencias','transferencias_custodia','solicitudes_acceso',
                           'alertas_integridad','registros_custodia','usuarios','ubicaciones',
                           'tipos_evidencia','roles','permisos','rol_permiso']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_sin_borrado()', 'nodel_'||t, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION trg_inmutable()', 'nodelt_'||t, t);
  END LOOP;
END $$;

-- Evidencia: los datos de identificación, recolección y el hash inicial no cambian.
CREATE FUNCTION trg_evidencias_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id_caso, NEW.codigo_unico, NEW.codigo_qr, NEW.id_tipo, NEW.nombre_referencia, NEW.descripcion,
      NEW.marca, NEW.modelo, NEW.numero_serie, NEW.capacidad_almacenamiento, NEW.estado_fisico,
      NEW.lugar_recoleccion, NEW.fecha_recoleccion, NEW.id_recolector, NEW.hash_inicial,
      NEW.observaciones, NEW.fecha_registro)
     IS DISTINCT FROM
     (OLD.id_caso, OLD.codigo_unico, OLD.codigo_qr, OLD.id_tipo, OLD.nombre_referencia, OLD.descripcion,
      OLD.marca, OLD.modelo, OLD.numero_serie, OLD.capacidad_almacenamiento, OLD.estado_fisico,
      OLD.lugar_recoleccion, OLD.fecha_recoleccion, OLD.id_recolector, OLD.hash_inicial,
      OLD.observaciones, OLD.fecha_registro)
  THEN
    RAISE EXCEPTION 'Los datos originales y el hash inicial de una evidencia no pueden modificarse.'
      USING ERRCODE = 'CD001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidencias_upd BEFORE UPDATE ON evidencias FOR EACH ROW EXECUTE FUNCTION trg_evidencias_upd();

-- Transferencia: máquina de estados y campos inmutables (RN-10, RN-22).
CREATE FUNCTION trg_transferencias_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('recibida','rechazada','cancelada') THEN
    RAISE EXCEPTION 'Una transferencia concluida no puede modificarse.' USING ERRCODE = 'CD001';
  END IF;
  IF (NEW.codigo, NEW.id_evidencia, NEW.id_entregante, NEW.id_receptor, NEW.id_ubicacion_destino,
      NEW.motivo, NEW.fecha_solicitud, NEW.fecha_entrega, NEW.firma_entregante)
     IS DISTINCT FROM
     (OLD.codigo, OLD.id_evidencia, OLD.id_entregante, OLD.id_receptor, OLD.id_ubicacion_destino,
      OLD.motivo, OLD.fecha_solicitud, OLD.fecha_entrega, OLD.firma_entregante) THEN
    RAISE EXCEPTION 'Los datos de la entrega no pueden modificarse.' USING ERRCODE = 'CD001';
  END IF;
  IF NOT ((OLD.estado = 'pendiente'  AND NEW.estado IN ('autorizada','rechazada','cancelada'))
       OR (OLD.estado = 'autorizada' AND NEW.estado IN ('recibida','cancelada'))
       OR (OLD.estado = NEW.estado)) THEN
    RAISE EXCEPTION 'Transición de transferencia no válida: % → %.', OLD.estado, NEW.estado USING ERRCODE = 'CD002';
  END IF;
  IF NEW.id_autorizador IS NOT NULL AND NEW.id_autorizador IN (OLD.id_entregante, OLD.id_receptor) THEN
    RAISE EXCEPTION 'Quien entrega o recibe no puede autorizar su propia transferencia.' USING ERRCODE = 'CD002';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transferencias_upd BEFORE UPDATE ON transferencias_custodia
  FOR EACH ROW EXECUTE FUNCTION trg_transferencias_upd();

-- Solicitud de acceso: la decisión no se reescribe; nadie aprueba la propia.
CREATE FUNCTION trg_solicitudes_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.codigo, NEW.id_evidencia, NEW.id_solicitante, NEW.alcance, NEW.motivo, NEW.fecha_solicitud, NEW.fecha_vencimiento)
     IS DISTINCT FROM
     (OLD.codigo, OLD.id_evidencia, OLD.id_solicitante, OLD.alcance, OLD.motivo, OLD.fecha_solicitud, OLD.fecha_vencimiento) THEN
    RAISE EXCEPTION 'Los datos de la solicitud no pueden modificarse.' USING ERRCODE = 'CD001';
  END IF;
  IF OLD.estado <> 'pendiente' AND
     (NEW.id_supervisor, NEW.fecha_respuesta, NEW.observaciones_supervisor)
       IS DISTINCT FROM (OLD.id_supervisor, OLD.fecha_respuesta, OLD.observaciones_supervisor) THEN
    RAISE EXCEPTION 'La decisión sobre la solicitud ya fue registrada.' USING ERRCODE = 'CD001';
  END IF;
  IF NOT ((OLD.estado = 'pendiente' AND NEW.estado IN ('aprobada','rechazada'))
       OR (OLD.estado = 'aprobada'  AND NEW.estado IN ('vencida','cerrada'))
       OR (OLD.estado = NEW.estado)) THEN
    RAISE EXCEPTION 'Transición de solicitud no válida: % → %.', OLD.estado, NEW.estado USING ERRCODE = 'CD002';
  END IF;
  IF NEW.id_supervisor IS NOT NULL AND NEW.id_supervisor = NEW.id_solicitante THEN
    RAISE EXCEPTION 'No puede resolver una solicitud creada por usted mismo.' USING ERRCODE = 'CD002';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitudes_upd BEFORE UPDATE ON solicitudes_acceso
  FOR EACH ROW EXECUTE FUNCTION trg_solicitudes_upd();

-- Alerta: los hashes que la originaron permanecen intactos.
CREATE FUNCTION trg_alertas_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('resuelta','descartada') THEN
    RAISE EXCEPTION 'Una alerta resuelta no puede modificarse.' USING ERRCODE = 'CD001';
  END IF;
  IF (NEW.codigo, NEW.id_evidencia, NEW.id_registro_hash, NEW.nivel, NEW.descripcion,
      NEW.hash_esperado, NEW.hash_observado, NEW.fecha_generacion)
     IS DISTINCT FROM
     (OLD.codigo, OLD.id_evidencia, OLD.id_registro_hash, OLD.nivel, OLD.descripcion,
      OLD.hash_esperado, OLD.hash_observado, OLD.fecha_generacion) THEN
    RAISE EXCEPTION 'Los valores de hash de una alerta se conservan sin cambios.' USING ERRCODE = 'CD001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alertas_upd BEFORE UPDATE ON alertas_integridad
  FOR EACH ROW EXECUTE FUNCTION trg_alertas_upd();

-- Custodia: solo se puede cerrar el registro vigente.
CREATE FUNCTION trg_custodia_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.es_custodia_actual AND NOT NEW.es_custodia_actual AND NEW.fecha_fin IS NOT NULL
          AND (NEW.id_evidencia, NEW.id_custodio, NEW.id_ubicacion, NEW.ubicacion, NEW.fecha_inicio, NEW.id_transferencia)
              IS NOT DISTINCT FROM
              (OLD.id_evidencia, OLD.id_custodio, OLD.id_ubicacion, OLD.ubicacion, OLD.fecha_inicio, OLD.id_transferencia)) THEN
    RAISE EXCEPTION 'El historial de custodia solo permite cerrar el registro vigente.' USING ERRCODE = 'CD001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER custodia_upd BEFORE UPDATE ON registros_custodia
  FOR EACH ROW EXECUTE FUNCTION trg_custodia_upd();

-- Caso: un caso cerrado no se reabre; el cierre exige que no existan pendientes.
CREATE FUNCTION trg_casos_upd() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pend text[];
BEGIN
  IF (NEW.codigo_caso, NEW.id_reportante, NEW.fecha_reporte, NEW.titulo, NEW.descripcion, NEW.tipo_incidente, NEW.lugar)
     IS DISTINCT FROM
     (OLD.codigo_caso, OLD.id_reportante, OLD.fecha_reporte, OLD.titulo, OLD.descripcion, OLD.tipo_incidente, OLD.lugar) THEN
    RAISE EXCEPTION 'Los datos del reporte original no pueden modificarse.' USING ERRCODE = 'CD001';
  END IF;
  IF OLD.estado IN ('cerrado','archivado') AND NEW.estado NOT IN ('cerrado','archivado') THEN
    RAISE EXCEPTION 'Un caso cerrado no puede reabrirse.' USING ERRCODE = 'CD002';
  END IF;
  IF OLD.estado IN ('cerrado','archivado') AND
     (NEW.fecha_cierre, NEW.motivo_cierre, NEW.id_supervisor_cierre)
       IS DISTINCT FROM (OLD.fecha_cierre, OLD.motivo_cierre, OLD.id_supervisor_cierre) THEN
    RAISE EXCEPTION 'El cierre del caso no puede modificarse.' USING ERRCODE = 'CD001';
  END IF;
  IF NEW.estado = 'cerrado' AND OLD.estado <> 'cerrado' THEN
    pend := pendientes_cierre(NEW.id_caso);
    IF array_length(pend, 1) > 0 THEN
      RAISE EXCEPTION 'El caso no puede cerrarse: %.', array_to_string(pend, ', ') USING ERRCODE = 'CD002';
    END IF;
    IF NEW.id_supervisor_cierre IS NULL OR coalesce(btrim(NEW.motivo_cierre), '') = '' OR NEW.fecha_cierre IS NULL THEN
      RAISE EXCEPTION 'El cierre requiere supervisor, fecha y motivo documentado.' USING ERRCODE = 'CD002';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER casos_upd BEFORE UPDATE ON casos FOR EACH ROW EXECUTE FUNCTION trg_casos_upd();

-- ---------------------------------------------------------------------
-- DATOS BASE: roles, permisos y configuración (no son datos de demostración)
-- ---------------------------------------------------------------------
INSERT INTO roles (nombre, descripcion) VALUES
 ('Reportante',       'Registra incidentes y sigue el estado de sus propios reportes.'),
 ('Recolector',       'Registra evidencia en casos permitidos y entrega lo que está bajo su responsabilidad.'),
 ('Custodio',         'Recibe, resguarda y entrega evidencia con confirmación personal.'),
 ('Analista forense', 'Trabaja sobre copias asignadas mediante un permiso aprobado y vigente.'),
 ('Supervisor',       'Autoriza accesos y transferencias, revisa integridad y decide el cierre de casos.'),
 ('Auditor',          'Consulta la operación y sus registros en modo de solo lectura.'),
 ('Administrador',    'Gestiona cuentas, asignación de roles, catálogos, configuración, respaldo y auditoría técnica.');

INSERT INTO permisos (codigo, nombre, descripcion) VALUES
 ('crear_caso',               'Registrar incidentes',                 'Según alcance'),
 ('consultar_casos',          'Consultar casos',                      'Propios / asignados / autorizados'),
 ('asignar_caso',             'Asignar recolectores a un caso',       'Casos no cerrados'),
 ('cerrar_caso',              'Cerrar caso',                          'Sin bloqueos pendientes'),
 ('registrar_evidencia',      'Registrar evidencia',                  'Casos permitidos y no cerrados'),
 ('consultar_evidencias',     'Consultar evidencia',                  'Relación o permiso vigente'),
 ('transferir_custodia',      'Entregar custodia',                    'Solo responsable actual'),
 ('autorizar_transferencia',  'Autorizar transferencia',              'Autorización documentada; no la propia'),
 ('recibir_custodia',         'Confirmar recepción',                  'Solo receptor asignado'),
 ('consultar_transferencias', 'Consultar transferencias',             'Propias; completas para Supervisor y Auditor'),
 ('solicitar_acceso',         'Solicitar acceso',                     'Con código de evidencia comunicado'),
 ('consultar_solicitudes',    'Consultar solicitudes de acceso',      'Propias; completas para Supervisor y Auditor'),
 ('decidir_solicitud',        'Aprobar o rechazar acceso',            'Sin autoaprobación'),
 ('registrar_analisis',       'Registrar análisis',                   'Copia autorizada vigente'),
 ('consultar_analisis',       'Consultar análisis forense',           'Propios; completos para Supervisor y Auditor'),
 ('verificar_integridad',     'Verificar integridad',                 'Original a cargo o supervisión'),
 ('consultar_alertas',        'Consultar alertas de integridad',      'Evidencia visible para su perfil'),
 ('revisar_alerta',           'Revisar alerta',                       'No altera el hash inicial'),
 ('consultar_ubicaciones',    'Consultar ubicaciones',                'Evidencia visible para su perfil'),
 ('ver_auditoria_global',     'Consultar auditoría global',           'Solo lectura'),
 ('ver_auditoria_tecnica',    'Consultar auditoría técnica',          'Administración, accesos y seguridad únicamente'),
 ('ver_actividad_propia',     'Consultar mi actividad',               'Solo acciones propias'),
 ('generar_reportes',         'Generar reportes operativos',          'Lectura y exportación'),
 ('descargar_original',       'Descargar original',                   'Evidencia a su cargo o supervisión'),
 ('descargar_copia',          'Descargar copia autorizada',           'Copia asignada con permiso vigente'),
 ('administrar_usuarios',     'Administrar usuarios y roles',         'Sin acceso al contenido de evidencia'),
 ('administrar_catalogos',    'Administrar catálogos y ubicaciones',  'Sin acceso al contenido de evidencia'),
 ('administrar_configuracion','Configuración y respaldo',             'Parámetros generales'),
 ('generar_reportes_admin',   'Generar reportes administrativos',     'Sin contenido de evidencia');

INSERT INTO rol_permiso (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
FROM (VALUES
 ('Reportante',       ARRAY['crear_caso','consultar_casos','ver_actividad_propia']),
 ('Recolector',       ARRAY['crear_caso','consultar_casos','registrar_evidencia','consultar_evidencias','transferir_custodia',
                           'consultar_transferencias','verificar_integridad','consultar_alertas','descargar_original','ver_actividad_propia']),
 ('Custodio',         ARRAY['consultar_evidencias','transferir_custodia','recibir_custodia','consultar_transferencias',
                           'verificar_integridad','consultar_alertas','consultar_ubicaciones','descargar_original','ver_actividad_propia']),
 ('Analista forense', ARRAY['consultar_casos','consultar_evidencias','solicitar_acceso','consultar_solicitudes','registrar_analisis',
                           'consultar_analisis','consultar_alertas','descargar_copia','ver_actividad_propia']),
 ('Supervisor',       ARRAY['crear_caso','consultar_casos','asignar_caso','cerrar_caso','consultar_evidencias','autorizar_transferencia',
                           'consultar_transferencias','consultar_solicitudes','decidir_solicitud','consultar_analisis',
                           'verificar_integridad','consultar_alertas','revisar_alerta','consultar_ubicaciones','ver_auditoria_global',
                           'generar_reportes','descargar_original']),
 ('Auditor',          ARRAY['consultar_casos','consultar_evidencias','consultar_transferencias','consultar_solicitudes','consultar_analisis',
                           'consultar_alertas','consultar_ubicaciones','ver_auditoria_global','generar_reportes']),
 ('Administrador',    ARRAY['consultar_ubicaciones','ver_auditoria_tecnica','administrar_usuarios','administrar_catalogos',
                           'administrar_configuracion','generar_reportes_admin'])
) AS m(rol, perms)
JOIN roles r ON r.nombre = m.rol
JOIN permisos p ON p.codigo = ANY (m.perms);

INSERT INTO configuracion (clave, valor) VALUES
 ('organizacion',            'Unidad académica de informática forense'),
 ('correo_soporte',          'soporte@custodia.demo'),
 ('vigencia_acceso_dias',    '7'),
 ('max_adjunto_kb',          '5120'),
 ('ultimo_respaldo',         '');

INSERT INTO tipos_evidencia (nombre) VALUES
 ('Dispositivo de almacenamiento'), ('Registro de eventos (Logs)'), ('Imagen forense'),
 ('Volcado de memoria'), ('Captura de pantalla'), ('Documento digital'),
 ('Correo electrónico'), ('Fotografía'), ('Video'), ('Equipo móvil'),
 ('Captura de tráfico de red'), ('Copia de seguridad');
