import { api } from '../api';
import { useAuth } from '../auth';
import { ROLE_DESCRIPTIONS, initials } from '../format';
import { Field, PageHead, useForm, useToast } from '../ui';

export default function Perfil() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const p = useForm({ nombres: user!.nombre.split(' ')[0], apellidos: user!.nombre.split(' ').slice(1).join(' '), unidad: user!.unidad });
  const c = useForm({ contrasena_actual: '', contrasena_nueva: '', confirmar: '' });
  const guardar = async (e: React.FormEvent) => { e.preventDefault(); try { await api.patch('/auth/me', p.v); await refresh(); toast('Perfil actualizado.'); } catch (x) { toast((x as Error).message, 'error'); } };
  const cambiar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (c.v.contrasena_nueva !== c.v.confirmar) return toast('La confirmación no coincide.', 'error');
    try { await api.patch('/auth/me', { contrasena_actual: c.v.contrasena_actual, contrasena_nueva: c.v.contrasena_nueva }); c.setV({ contrasena_actual: '', contrasena_nueva: '', confirmar: '' }); toast('Contraseña actualizada.'); } catch (x) { toast((x as Error).message, 'error'); }
  };
  return (
    <div className="stack">
      <PageHead title="Mi perfil" desc="Datos de su cuenta. El rol solo puede cambiarlo un administrador." />
      <div className="grid2">
        <section className="card"><div className="row" style={{ marginBottom: 18 }}><span className="avatar profile-avatar">{initials(user!.nombre)}</span><div><h2>{user!.nombre}</h2><div className="muted small">{user!.correo} · {user!.codigo}</div><span className="badge info">{user!.rol}</span></div></div>
          <p className="small muted" style={{ marginBottom: 16 }}>{ROLE_DESCRIPTIONS[user!.rol]}</p>
          <form onSubmit={guardar}><div className="grid2"><Field label="Nombres"><input {...p.bind('nombres')} required /></Field><Field label="Apellidos"><input {...p.bind('apellidos')} required /></Field></div><Field label="Unidad"><input {...p.bind('unidad')} /></Field><button className="btn primary">Guardar</button></form></section>
        <section className="card"><div className="card-head"><h2>Cambiar contraseña</h2></div><form onSubmit={cambiar}>
          <Field label="Contraseña actual"><input type="password" autoComplete="current-password" {...c.bind('contrasena_actual')} required /></Field>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números."><input type="password" autoComplete="new-password" {...c.bind('contrasena_nueva')} required minLength={8} /></Field>
          <Field label="Confirmar nueva contraseña"><input type="password" autoComplete="new-password" {...c.bind('confirmar')} required /></Field><button className="btn primary">Actualizar contraseña</button></form></section>
      </div>
    </div>
  );
}
