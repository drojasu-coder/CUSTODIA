import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ESTADO_EVID } from '../format';
import { Badge, ErrorBox, Loading, Notice, PageHead, SemaforoBadge, useLoad } from '../ui';

export default function Ubicaciones() {
  const { user } = useAuth();
  const { data, error } = useLoad(() => api.get('/catalogos/ubicaciones'), []);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <PageHead title="Ubicaciones" desc="Lugares físicos o lógicos donde se resguarda la evidencia, con su capacidad y ocupación." />
      {user!.rol === 'Administrador' && <Notice>La administración ve la ocupación, pero no qué evidencias hay en cada ubicación.</Notice>}
      <div className="grid2">{data.map((u: any) => { const pct = Math.min(100, Math.round(u.ocupacion / u.capacidad * 100)); return (
        <section className="card" key={u.id_ubicacion}><div className="card-head"><div><h3>{u.nombre}</h3><div className="small muted">{u.codigo} · {u.tipo === 'fisica' ? 'Física' : 'Lógica'}{!u.activo && ' · Inactiva'}</div></div><span className={'badge ' + (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'good')}>{u.ocupacion}/{u.capacidad}</span></div>
          <div className="bar"><span style={{ width: pct + '%', background: pct >= 90 ? 'var(--red)' : undefined }} /></div>
          <div className="spacer">{u.evidencias.length === 0 ? <span className="small muted">{user!.rol === 'Administrador' ? '' : 'Sin evidencias visibles para su perfil.'}</span> : u.evidencias.map((e: any) => <div className="list-row" key={e.id_evidencia}><div className="body"><Link to={'/evidencias/' + e.id_evidencia}><strong>{e.codigo_unico}</strong></Link> <span className="small muted">{e.nombre_referencia}</span></div><div className="row wrap" style={{ gap: 6 }}><SemaforoBadge estado={e.estado} integridad={e.integridad} /><Badge map={ESTADO_EVID} v={e.estado} /></div></div>)}</div></section>); })}</div>
    </div>
  );
}
