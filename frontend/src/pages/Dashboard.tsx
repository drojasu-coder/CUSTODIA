import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { dateFmt } from '../format';
import { Empty, ErrorBox, Icon, Loading, PageHead, useLoad } from '../ui';

const RUTA: Record<string, string> = { transferencia: '/custodia', solicitud: '/solicitudes', alerta: '/alertas' };

export default function Dashboard() {
  const { user, can } = useAuth();
  const { data, error } = useLoad(() => api.get('/panel'), []);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  const kpis: [string, number, string, string][] = [];
  if (can('consultar_casos')) kpis.push(['Casos visibles', data.casos, 'folder', '/casos']);
  if (can('consultar_evidencias')) kpis.push(['Evidencias', data.evidencias, 'drive', '/evidencias']);
  if (can('consultar_alertas')) kpis.push(['Alertas abiertas', data.alertas_abiertas, 'shield', '/alertas']);
  if (can('consultar_transferencias')) kpis.push(['Transferencias pendientes', data.transferencias_pendientes, 'transfer', '/custodia']);
  if (can('consultar_solicitudes') && kpis.length < 4) kpis.push(['Solicitudes pendientes', data.solicitudes_pendientes ?? 0, 'key', '/solicitudes']);
  return (
    <div className="stack">
      <PageHead title={`Hola, ${user!.nombre.split(' ')[0]}`} desc="Resumen de lo que su rol puede ver y atender hoy." />
      <div className="kpis">{kpis.map(([l, n, ic, to]) => <Link key={l} to={to} className="kpi" style={{ textDecoration: 'none' }}><Icon n={ic} /><span className="number">{n}</span><span className="label">{l}</span></Link>)}</div>
      <div className="dashboard-cols">
        <section className="card"><div className="card-head"><h2>Tareas pendientes</h2></div>
          {data.tareas.length === 0 ? <Empty icon="check" title="Sin tareas pendientes" text="No hay acciones que requieran su atención." /> :
            data.tareas.map((t: any) => {
              const esCopia = t.texto?.toLowerCase().includes('copia autorizada');
              return (
                <div className="list-row" key={t.tipo + t.id}>
                  <Icon n={esCopia ? 'key' : 'alert'} />
                  <div className="body">
                    <strong>{t.texto}</strong>
                    <div className="small muted">{t.ref}</div>
                  </div>
                  {esCopia ? (
                    <div className="row wrap" style={{ gap: 6 }}>
                      <Link className="btn mini" to="/solicitudes">Solicitudes</Link>
                      <Link className="btn mini primary" to={`/analisis?inicial=${t.id}`}>Registrar análisis</Link>
                    </div>
                  ) : (
                    <Link className="btn mini" to={RUTA[t.tipo] || '/'}>Abrir</Link>
                  )}
                </div>
              );
            })}
        </section>
        <section className="card"><div className="card-head"><h2>Actividad reciente</h2></div>
          {data.recientes.length === 0 ? <Empty icon="clock" title="Sin actividad" /> :
            <div className="timeline">{data.recientes.map((r: any) => <div className="timeline-item" key={r.codigo}><strong>{r.accion}</strong><div className="small muted">{r.usuario} · {dateFmt(r.fecha_hora)}</div><p className="mono">{r.referencia}</p></div>)}</div>}
        </section>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const { data, error } = useLoad(() => api.get('/admin/resumen'), []);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  const k: [string, string | number, string, string][] = [['Usuarios', data.usuarios, 'users', '/admin/usuarios'], ['Cuentas activas', data.activos, 'check', '/admin/usuarios'],
    ['Roles', data.roles, 'lock', '/admin/roles'], ['Accesos fallidos (7 días)', data.accesos_fallidos, 'alert', '/auditoria']];
  return (
    <div className="stack">
      <PageHead title="Panel administrativo" desc="Gestión de cuentas, roles, catálogos y configuración. La administración no tiene acceso al contenido de la evidencia." />
      <div className="kpis">{k.map(([l, n, ic, to]) => <Link key={l} to={to} className="kpi" style={{ textDecoration: 'none' }}><Icon n={ic} /><span className="number">{n}</span><span className="label">{l}</span></Link>)}</div>
      <section className="card"><div className="card-head"><h2>Respaldo</h2></div><p>Último respaldo lógico: <strong>{data.ultimo_respaldo ? dateFmt(data.ultimo_respaldo) : 'nunca'}</strong>. Ubicaciones activas: {data.ubicaciones}.</p></section>
    </div>
  );
}
