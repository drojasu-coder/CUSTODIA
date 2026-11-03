import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { Db, one, q } from './db';
import { HttpError } from './errors';
import { sha256 } from './util';

/**
 * Repositorio de archivos.
 *  - Driver "db" (por defecto): contenido en la tabla archivos_contenido (BYTEA, solo inserción).
 *    La ruta guardada en archivos_evidencia es "db:<sub>/<uuid>.bin". Persistente en Render Free.
 *  - Driver "local": disco en STORAGE_DIR (ruta relativa). Se conserva la lectura de rutas locales
 *    antiguas aunque el driver activo sea "db".
 */
const PREFIJO_DB = 'db:';

/** Límite duro por archivo (además de max_adjunto_kb configurable). */
export const maxArchivoBytes = () => config.storageMaxKb * 1024;

export async function guardar(db: Db, buf: Buffer, sub: 'originales' | 'copias'): Promise<string> {
  if (buf.length > maxArchivoBytes()) throw new HttpError(413, `El archivo excede el máximo del repositorio (${config.storageMaxKb} KB).`, 'archivo_grande');
  const nombre = `${sub}/${crypto.randomUUID()}.bin`;
  if (config.storageDriver === 'local') {
    const dir = path.join(config.storageDir, sub);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(config.storageDir, nombre), buf, { mode: 0o640 });
    return nombre;
  }
  const usado = Number((await one(db, 'select coalesce(sum(tamano_bytes),0)::bigint as n from archivos_contenido'))!.n);
  if (usado + buf.length > config.storageQuotaMb * 1024 * 1024) {
    throw new HttpError(507, 'Se alcanzó la cuota de almacenamiento de archivos del prototipo.', 'cuota_almacenamiento');
  }
  await q(db, 'insert into archivos_contenido (clave, contenido, tamano_bytes, hash_sha256) values ($1,$2,$3,$4)',
    [nombre, buf, buf.length, sha256(buf)]);
  return PREFIJO_DB + nombre;
}

export async function leer(db: Db, rel: string): Promise<Buffer> {
  if (rel.startsWith(PREFIJO_DB)) {
    const r = await one<{ contenido: Buffer }>(db, 'select contenido from archivos_contenido where clave=$1', [rel.slice(PREFIJO_DB.length)]);
    if (!r) throw new HttpError(404, 'El archivo no está disponible en el repositorio.', 'archivo_ausente');
    return r.contenido;
  }
  const abs = path.resolve(config.storageDir, rel);
  if (!abs.startsWith(config.storageDir + path.sep)) throw new HttpError(400, 'Ruta de archivo inválida.');
  if (!fs.existsSync(abs)) throw new HttpError(404, 'El archivo no está disponible en el repositorio.', 'archivo_ausente');
  return fs.readFileSync(abs);
}

export const nombreSeguro = (n: string) => n.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 200) || 'archivo';

// ------------------------------------------------------------------ validación de adjuntos
/** Formatos habituales de evidencia digital admitidos en el prototipo. */
const EXTENSIONES = new Set(('txt log csv json xml pdf png jpg jpeg gif bmp tif tiff webp heic mp4 mov avi mkv mp3 wav ogg m4a ' +
  'eml msg mbox pcap pcapng cap zip 7z gz tgz tar rar e01 ex01 aff dd img raw iso bin mem dmp vmem lime evtx evt ' +
  'doc docx xls xlsx ppt pptx odt ods odp rtf db sqlite sqlite3 plist reg hive').split(' '));
const FIRMAS: Record<string, (b: Buffer) => boolean> = {
  pdf: b => b.subarray(0, 5).toString('latin1') === '%PDF-',
  png: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: b => b.subarray(0, 4).toString('latin1') === 'GIF8',
  zip: b => b.subarray(0, 2).toString('latin1') === 'PK',
  docx: b => b.subarray(0, 2).toString('latin1') === 'PK',
  xlsx: b => b.subarray(0, 2).toString('latin1') === 'PK',
  pptx: b => b.subarray(0, 2).toString('latin1') === 'PK',
  gz: b => b[0] === 0x1f && b[1] === 0x8b,
  '7z': b => b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])),
};
export const extensionDe = (nombre: string) => {
  const i = nombre.lastIndexOf('.');
  return i > 0 && i < nombre.length - 1 ? nombre.slice(i + 1).toLowerCase().slice(0, 20) : '';
};
/** Lanza 400 si el archivo no es de un formato admitido o su contenido no corresponde a la extensión. */
export function validarAdjunto(nombre: string, buf: Buffer): string {
  const ext = extensionDe(nombre);
  if (!ext || !EXTENSIONES.has(ext)) {
    throw new HttpError(400, `Formato de archivo no admitido (.${ext || 'sin extensión'}). Formatos permitidos: ${[...EXTENSIONES].join(', ')}.`, 'archivo_invalido');
  }
  // Ejecutables de Windows/Linux disfrazados con otra extensión.
  if (buf.subarray(0, 2).toString('latin1') === 'MZ' || buf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new HttpError(400, 'El contenido corresponde a un programa ejecutable: no se admite en el prototipo.', 'archivo_invalido');
  }
  if (FIRMAS[ext] && !FIRMAS[ext](buf)) throw new HttpError(400, `El contenido del archivo no corresponde a un .${ext}.`, 'archivo_invalido');
  return ext;
}
/** Cabeceras de descarga: siempre binario opaco y adjunto (el navegador nunca interpreta el contenido). */
export const cabecerasDescarga = (nombre: string, hash: string) => ({
  'Content-Type': 'application/octet-stream',
  'Content-Disposition': `attachment; filename="${encodeURIComponent(nombre)}"`,
  'X-SHA256': hash,
  'Cache-Control': 'no-store',
});
