import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { dateFmt, ROLE_DESCRIPTIONS } from '../format';
import { ErrorBox, Field, Icon, Loading, Modal, Notice, PageHead, useAction, useForm, useLoad, useToast } from '../ui';

export function AdminUsuarios() {
  const { user } = useAuth();
  const run = useAction();
  const { data, error, reload } = useLoad(() => api.get('/admin/usuarios'), []);
  const roles = useLoad(() => api.get('/admin/roles'), []);
  const [edit, setEdit] = useState<any | 'nuevo' | null>(null), [pwd, setPwd] = useState<any>(null);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <PageHead title="Usuarios y accesos" desc="Alta de cuentas, asignación de rol y estado. Las cuentas no se eliminan: se desactivan y su historial se conserva."><button className="btn primary" onClick={() => setEdit('nuevo')}><Icon n="plus" />Nuevo usuario</button></PageHead>
      <section className="card"><div className="table-wrap"><table><thead><tr><th>Código</th><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th /></tr></thead>
        <tbody>{data.map((u: any) => <tr key={u.id_usuario}><td><strong>{u.codigo}</strong></td><td>{u.nombres} {u.apellidos}<div className="small muted">{u.unidad}</div></td><td>{u.correo}</td><td><span className="badge info">{u.rol}</span></td>
          <td>{u.activo ? <span className="badge good">Activo</span> : <span className="badge">Inactivo</span>}</td><td>{dateFmt(u.ultimo_acceso)}</td>
          <td><div className="row gap-sm wrap"><button className="btn mini" onClick={() => setEdit(u)}>Editar</button><button className="btn mini" onClick={() => setPwd(u)}>Contraseña</button>
            {u.id_usuario !== user!.id && <button className={'btn mini ' + (u.activo ? 'danger' : 'success')} onClick={() => run(() => api.patch('/admin/usuarios/' + u.id_usuario, { activo: !u.activo }), u.activo ? 'Cuenta desactivada.' : 'Cuenta activada.', reload)}>{u.activo ? 'Desactivar' : 'Activar'}</button>}</div></td></tr>)}</tbody></table></div></section>
      {edit && <Usuario u={edit === 'nuevo' ? null : edit} roles={roles.data?.roles ?? []} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {pwd && <Password u={pwd} onClose={() => setPwd(null)} />}
    </div>
  );
}
function Usuario({ u, roles, onClose, onDone }: { u: any | null; roles: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ nombres: u?.nombres ?? '', apellidos: u?.apellidos ?? '', correo: u?.correo ?? '', unidad: u?.unidad ?? '', id_rol: String(u?.id_rol ?? ''), contrasena: '' });
  return (
    <Modal title={u ? `Editar ${u.codigo}` : 'Nuevo usuario'} onClose={onClose} onSubmit={async () => {
      const body: any = { ...v, id_rol: Number(v.id_rol) };
      if (u) { delete body.contrasena; await api.patch('/admin/usuarios/' + u.id_usuario, body); } else await api.post('/admin/usuarios', body);
      toast(u ? 'Usuario actualizado.' : 'Usuario creado.'); onDone();
    }}>
      <div className="grid2"><Field label="Nombres"><input {...bind('nombres')} required /></Field><Field label="Apellidos"><input {...bind('apellidos')} required /></Field></div>
      <Field label="Correo"><input type="email" {...bind('correo')} required /></Field><Field label="Unidad"><input {...bind('unidad')} /></Field>
      <Field label="Rol"><select {...bind('id_rol')} required><option value="">Seleccione…</option>{roles.map(r => <option key={r.id_rol} value={r.id_rol}>{r.nombre}</option>)}</select></Field>
      {!u && <Field label="Contraseña inicial" hint="Mínimo 8 caracteres, con letras y números."><input type="password" autoComplete="new-password" {...bind('contrasena')} required minLength={8} /></Field>}
    </Modal>
  );
}
function Password({ u, onClose }: { u: any; onClose: () => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ contrasena: '' });
  return <Modal title={`Restablecer contraseña de ${u.codigo}`} onClose={onClose} onSubmit={async () => { await api.patch('/admin/usuarios/' + u.id_usuario, v); toast('Contraseña restablecida.'); onClose(); }}>
    <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números."><input type="password" autoComplete="new-password" {...bind('contrasena')} required minLength={8} /></Field></Modal>;
}

export function AdminRoles() {
  const { data, error } = useLoad(() => api.get('/admin/roles'), []);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  const tiene = (r: number, p: number) => data.asignaciones.some((a: any) => a.id_rol === r && a.id_permiso === p);
  return (
    <div className="stack">
      <PageHead title="Roles y permisos" desc="Matriz de permisos por rol. Algunos permisos se validan además por objeto (caso, evidencia o solicitud)." />
      <div className="grid3">{data.roles.map((r: any) => <section className="card" key={r.id_rol}><h3>{r.nombre}</h3><p className="small muted spacer">{ROLE_DESCRIPTIONS[r.nombre] ?? r.descripcion}</p><span className="badge info spacer">{r.usuarios} usuarios</span></section>)}</div>
      <section className="card"><div className="table-wrap"><table className="permission-table"><thead><tr><th>Permiso</th>{data.roles.map((r: any) => <th key={r.id_rol}>{r.nombre}</th>)}<th>Condición</th></tr></thead>
        <tbody>{data.permisos.map((p: any) => <tr key={p.id_permiso}><td><strong>{p.nombre}</strong></td>{data.roles.map((r: any) => <td key={r.id_rol}>{tiene(r.id_rol, p.id_permiso) ? <span className="badge good">Sí</span> : <span className="muted">—</span>}</td>)}<td className="muted">{p.descripcion}</td></tr>)}</tbody></table></div></section>
    </div>
  );
}

export function AdminCatalogos() {
  const run = useAction();
  const ubs = useLoad(() => api.get('/catalogos/ubicaciones'), []);
  const tipos = useLoad(() => api.get('/catalogos/tipos-evidencia'), []);
  const [modal, setModal] = useState<any>(null);
  const nt = useForm({ nombre: '' });
  if (ubs.error) return <ErrorBox e={ubs.error} />;
  if (!ubs.data || !tipos.data) return <Loading />;
  return (
    <div className="stack">
      <PageHead title="Catálogos" desc="Ubicaciones y tipos de evidencia. No se eliminan: se desactivan."><button className="btn primary" onClick={() => setModal({})}><Icon n="plus" />Nueva ubicación</button></PageHead>
      <section className="card"><div className="card-head"><h2>Ubicaciones</h2></div><div className="table-wrap"><table><thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Ocupación</th><th>Estado</th><th /></tr></thead>
        <tbody>{ubs.data.map((u: any) => <tr key={u.id_ubicacion}><td><strong>{u.codigo}</strong></td><td>{u.nombre}</td><td>{u.tipo === 'fisica' ? 'Física' : 'Lógica'}</td><td>{u.ocupacion}/{u.capacidad}</td><td>{u.activo ? <span className="badge good">Activa</span> : <span className="badge">Inactiva</span>}</td>
          <td><div className="row gap-sm"><button className="btn mini" onClick={() => setModal(u)}>Editar</button><button className="btn mini" onClick={() => run(() => api.patch('/catalogos/ubicaciones/' + u.id_ubicacion, { activo: !u.activo }), 'Estado actualizado.', ubs.reload)}>{u.activo ? 'Desactivar' : 'Activar'}</button></div></td></tr>)}</tbody></table></div></section>
      <section className="card"><div className="card-head"><h2>Tipos de evidencia</h2></div>
        <form className="toolbar" onSubmit={e => { e.preventDefault(); run(() => api.post('/catalogos/tipos-evidencia', nt.v), 'Tipo agregado.', () => { nt.setV({ nombre: '' }); tipos.reload(); }); }}>
          <input className="control" placeholder="Nuevo tipo de evidencia" {...nt.bind('nombre')} required minLength={3} aria-label="Nuevo tipo" /><button className="btn primary">Agregar</button></form>
        <div className="row wrap">{tipos.data.map((t: any) => <span key={t.id_tipo} className={'badge ' + (t.activo ? 'info' : '')}>{t.nombre}
          <button className="btn ghost mini" aria-label={t.activo ? 'Desactivar' : 'Activar'} onClick={() => run(() => api.patch('/catalogos/tipos-evidencia/' + t.id_tipo, { activo: !t.activo }), 'Tipo actualizado.', tipos.reload)} style={{ minHeight: 0, padding: '0 4px' }}>{t.activo ? '×' : '↺'}</button></span>)}</div></section>
      {modal && <Ubicacion u={modal.id_ubicacion ? modal : null} onClose={() => setModal(null)} onDone={() => { setModal(null); ubs.reload(); }} />}
    </div>
  );
}
function Ubicacion({ u, onClose, onDone }: { u: any | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ nombre: u?.nombre ?? '', tipo: u?.tipo ?? 'fisica', capacidad: String(u?.capacidad ?? 10) });
  return <Modal title={u ? `Editar ${u.codigo}` : 'Nueva ubicación'} onClose={onClose} onSubmit={async () => {
    const body = { ...v, capacidad: Number(v.capacidad) };
    if (u) await api.patch('/catalogos/ubicaciones/' + u.id_ubicacion, body); else await api.post('/catalogos/ubicaciones', body);
    toast('Ubicación guardada.'); onDone(); }}>
    <Field label="Nombre"><input {...bind('nombre')} required minLength={3} /></Field>
    <div className="grid2"><Field label="Tipo"><select {...bind('tipo')}><option value="fisica">Física</option><option value="logica">Lógica</option></select></Field><Field label="Capacidad"><input type="number" min={1} {...bind('capacidad')} required /></Field></div></Modal>;
}

export function AdminConfig() {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.get('/admin/configuracion'), []);
  const f = useForm({ organizacion: '', correo_soporte: '', vigencia_acceso_dias: '7', max_adjunto_kb: '5120' });
  const [cargado, setCargado] = useState(false);
  useEffect(() => {
    if (data && !cargado) {
      f.setV({
        organizacion: data.organizacion ?? '',
        correo_soporte: data.correo_soporte ?? '',
        vigencia_acceso_dias: String(data.vigencia_acceso_dias ?? '7'),
        max_adjunto_kb: String(data.max_adjunto_kb ?? '5120')
      });
      setCargado(true);
    }
  }, [data, cargado, f]);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  const guardar = async (e: React.FormEvent) => { e.preventDefault(); try { await api.put('/admin/configuracion', { ...f.v, vigencia_acceso_dias: Number(f.v.vigencia_acceso_dias), max_adjunto_kb: Number(f.v.max_adjunto_kb) }); toast('Configuración guardada.'); reload(); } catch (x) { toast((x as Error).message, 'error'); } };
  const respaldo = async () => { try { await api.download('/admin/respaldo', 'respaldo.json', 'POST'); toast('Respaldo generado.'); reload(); } catch (x) { toast((x as Error).message, 'error'); } };
  return (
    <div className="stack">
      <PageHead title="Configuración y respaldo" desc="Parámetros generales y respaldo lógico de cuentas y catálogos." />
      <div className="grid2">
        <section className="card"><div className="card-head"><h2>Parámetros</h2></div><form onSubmit={guardar}>
          <Field label="Organización"><input {...f.bind('organizacion')} required /></Field><Field label="Correo de soporte"><input type="email" {...f.bind('correo_soporte')} required /></Field>
          <div className="grid2"><Field label="Vigencia de accesos (días)"><input type="number" min={1} max={30} {...f.bind('vigencia_acceso_dias')} required /></Field><Field label="Tamaño máximo de archivo (KB)"><input type="number" min={1} {...f.bind('max_adjunto_kb')} required /></Field></div>
          <button className="btn primary">Guardar</button></form></section>
        <section className="card"><div className="card-head"><h2>Respaldo lógico</h2></div>
          <Notice>Incluye cuentas (sin contraseñas), roles, ubicaciones, tipos y configuración. No incluye evidencias ni su historial: eso se respalda con la base de datos y la carpeta de almacenamiento.</Notice>
          <p className="spacer">Último respaldo: <strong>{data.ultimo_respaldo ? dateFmt(data.ultimo_respaldo) : 'nunca'}</strong></p><div className="spacer"><button className="btn" onClick={respaldo}><Icon n="download" />Generar respaldo</button></div></section>
      </div>
    </div>
  );
}
