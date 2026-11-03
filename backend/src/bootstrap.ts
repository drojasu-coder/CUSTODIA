// Primer acceso administrador (idempotente). Se configura con variables de entorno:
//   ADMIN_EMAIL, ADMIN_PASSWORD (obligatorias para crearlo), ADMIN_USERNAME, ADMIN_NOMBRES, ADMIN_APELLIDOS.
// Solo crea la cuenta si no existe ningún usuario con ese correo/usuario. Nunca cambia la contraseña de
// una cuenta existente (para rotarla, use "Mi perfil" o la administración de usuarios).
import bcrypt from 'bcryptjs';
import { audit } from './audit';
import { config } from './config';
import { one, pool, tx } from './db';
import { passwordSchema } from './routes/auth';

export async function bootstrapAdmin(): Promise<'creado' | 'existente' | 'omitido'> {
  const correo = process.env.ADMIN_EMAIL?.trim();
  const pass = process.env.ADMIN_PASSWORD;
  if (!correo || !pass) return 'omitido';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error('ADMIN_EMAIL no es un correo válido.');
  const usuario = (process.env.ADMIN_USERNAME?.trim() || correo.split('@')[0]).slice(0, 50);
  const existe = await one(pool, 'select 1 from usuarios where lower(correo)=lower($1) or lower(nombre_usuario)=lower($2)', [correo, usuario]);
  if (existe) return 'existente';

  const v = passwordSchema.safeParse(pass);
  if (!v.success) throw new Error('ADMIN_PASSWORD inválida: ' + v.error.issues.map(i => i.message).join(' '));
  if (config.isProd && (pass.length < 12 || pass === 'Demo123!')) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres en producción.');

  await tx(async c => {
    const rol = (await one(c, `select id_rol from roles where nombre='Administrador'`))!.id_rol;
    // USR-00 queda reservado al admin inicial para no chocar con las cuentas de demostración (USR-01..07).
    const n = (await one(c, `select case when exists (select 1 from usuarios where codigo='USR-00')
        then (select coalesce(max(substring(codigo from 5)::int),0)+1 from usuarios where codigo ~ '^USR-[0-9]+$') else 0 end as n`))!.n;
    const u = (await one(c, `insert into usuarios (codigo,id_rol,nombres,apellidos,correo,nombre_usuario,unidad,contrasena_hash)
        values ($1,$2,$3,$4,$5,$6,'Administración de plataforma',$7) returning id_usuario, codigo`,
      [`USR-${String(n).padStart(2, '0')}`, rol, process.env.ADMIN_NOMBRES?.trim() || 'Administrador', process.env.ADMIN_APELLIDOS?.trim() || 'Inicial',
       correo, usuario, await bcrypt.hash(pass, 10)]))!;
    await audit(c, null, null, { modulo: 'Administración', accion: 'Alta de administrador inicial', referencia: u.codigo,
      descripcion: 'Cuenta creada por el arranque del sistema a partir de variables de entorno.' }, 'Sistema');
  });
  return 'creado';
}
