import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { dateFmt, ESTADO_CASO, ESTADO_EVID, INTEGRIDAD } from '../format';
import { RegistrarEvidencia as RegistrarEvidenciaLazy } from './Evidencias';
import { Badge, Detail, Empty, ErrorBox, Field, Icon, Loading, Modal, Notice, PageHead, Pager, SemaforoBadge, useAction, useForm, useLoad, useToast } from '../ui';

export function Casos() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [page, setPage] = useState(1), [estado, setEstado] = useState(''), [busq, setBusq] = useState(''), [nuevo, setNuevo] = useState(false);
  const { data, error, reload } = useLoad(() => api.get('/casos' + qs({ page, estado, q: busq })), [page, estado, busq]);
  return (
    <div className="stack">
      <PageHead title="Casos e incidentes" desc="Cada caso agrupa las evidencias y su trazabilidad. Verá solo los casos que le corresponden.">
        {can('crear_caso') && <button className="btn primary" onClick={() => setNuevo(true)}><Icon n="plus" />Registrar incidente</button>}
      </PageHead>
      <section className="card">
        <div className="toolbar"><input className="control" placeholder="Buscar por código, título o tipo" value={busq} onChange={e => { setBusq(e.target.value); setPage(1); }} aria-label="Buscar casos" />
          <select className="control" value={estado} onChange={e => { setEstado(e.target.value); setPage(1); }} aria-label="Estado">
            <option value="">Todos los estados</option>{Object.entries(ESTADO_CASO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        {error ? <ErrorBox e={error} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="Sin casos" text="No hay casos que coincidan con el filtro." /> :
          <div className="table-wrap"><table><thead><tr><th>Código</th><th>Título</th><th>Tipo</th><th>Estado</th><th>Evidencias</th><th>Reportado</th><th /></tr></thead>
            <tbody>{data.items.map((c: any) => <tr key={c.id_caso}><td><strong>{c.codigo_caso}</strong></td><td>{c.titulo}<div className="small muted">{c.lugar}</div></td><td>{c.tipo_incidente}</td>
              <td><Badge map={ESTADO_CASO} v={c.estado} /></td><td>{c.evidencias}</td><td>{dateFmt(c.fecha_reporte)}</td>
              <td><button className="btn mini" onClick={() => nav('/casos/' + c.id_caso)}>Ver</button></td></tr>)}</tbody></table></div>}
        {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </section>
      {nuevo && <NuevoCaso onClose={() => setNuevo(false)} onDone={(newId) => { setNuevo(false); reload(); if (newId) nav('/casos/' + newId); }} />}
    </div>
  );
}

function NuevoCaso({ onClose, onDone }: { onClose: () => void; onDone: (id?: number) => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ titulo: '', tipo_incidente: '', lugar: '', descripcion: '' });
  return (
    <Modal title="Registrar incidente" onClose={onClose} submitLabel="Registrar" onSubmit={async () => {
      const c = await api.post('/casos', v);
      toast(`Caso ${c.codigo_caso} registrado.`);
      onDone(c.id_caso);
    }}>
      <Field label="Título"><input {...bind('titulo')} required minLength={5} maxLength={180} /></Field>
      <Field label="Tipo de incidente"><input {...bind('tipo_incidente')} required placeholder="Ej.: Intrusión informática" /></Field>
      <Field label="Lugar"><input {...bind('lugar')} required /></Field>
      <Field label="Descripción" hint="Use únicamente información ficticia."><textarea {...bind('descripcion')} required minLength={10} /></Field>
    </Modal>
  );
}

export function CasoDetalle() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const run = useAction();
  const { data, error, reload } = useLoad(() => api.get('/casos/' + id), [id]);
  const [modal, setModal] = useState<'asignar' | 'cerrar' | 'evidencia' | null>(null);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  const abierto = !['cerrado', 'archivado'].includes(data.estado);
  const cierre = () => setModal('cerrar');
  return (
    <div className="stack">
      <PageHead title={`${data.codigo_caso} · ${data.titulo}`} desc={data.tipo_incidente}>
        <Link className="btn" to="/casos">Volver</Link>
        {can('registrar_evidencia') && abierto && <button className="btn primary" onClick={() => setModal('evidencia')}><Icon n="plus" />Registrar evidencia</button>}
        {can('asignar_caso') && abierto && <button className="btn" onClick={() => setModal('asignar')}><Icon n="users" />Asignar recolector</button>}
        {can('cerrar_caso') && abierto && <>
          {data.estado !== 'suspendido' ? <button className="btn" onClick={() => run(() => api.post(`/casos/${id}/estado`, { estado: 'suspendido' }), 'Caso suspendido.', reload)}>Suspender</button>
            : <button className="btn" onClick={() => run(() => api.post(`/casos/${id}/estado`, { estado: 'en_investigacion' }), 'Caso reactivado.', reload)}>Reactivar</button>}
          <button className="btn danger" onClick={cierre}>Cerrar caso</button></>}
      </PageHead>
      <section className="card">
        <Detail items={[['Estado', <Badge map={ESTADO_CASO} v={data.estado} />], ['Reportante', data.reportante], ['Responsable', data.responsable], ['Lugar', data.lugar], ['Reportado', dateFmt(data.fecha_reporte)],
          ['Cierre', data.fecha_cierre ? dateFmt(data.fecha_cierre) : '—']]} />
        <div className="spacer"><div className="section-title">Descripción</div><p>{data.descripcion}</p></div>
        {data.motivo_cierre && <div className="spacer"><div className="section-title">Motivo de cierre</div><p>{data.motivo_cierre}</p></div>}
        {data.asignados.length > 0 && <div className="spacer"><div className="section-title">Recolectores asignados</div><div className="row wrap">{data.asignados.map((a: any) => <span className="badge info" key={a.id_usuario}>{a.nombre}</span>)}</div></div>}
      </section>
      {abierto && data.pendientes_cierre.length > 0 && can('cerrar_caso') && <Notice tone="warn">El caso no puede cerrarse todavía: {data.pendientes_cierre.join(', ')}.</Notice>}
      <section className="card"><div className="card-head"><h2>Evidencias</h2></div>
        {data.evidencias.length === 0 ? <Empty icon="drive" title="Sin evidencias visibles" /> :
          <div className="table-wrap"><table><thead><tr><th>Código</th><th>Referencia</th><th>Tipo</th><th>Semáforo</th><th>Estado</th><th>Integridad</th><th>Custodio</th></tr></thead>
            <tbody>{data.evidencias.map((e: any) => <tr key={e.id_evidencia}><td><Link to={'/evidencias/' + e.id_evidencia}><strong>{e.codigo_unico}</strong></Link></td><td>{e.nombre_referencia}</td><td>{e.tipo}</td>
              <td><SemaforoBadge estado={e.estado} integridad={e.integridad} /></td>
              <td><Badge map={ESTADO_EVID} v={e.estado} /></td><td><Badge map={INTEGRIDAD} v={e.integridad} /></td><td>{e.custodio}</td></tr>)}</tbody></table></div>}
      </section>
      {modal === 'asignar' && <Asignar id={data.id_caso} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'cerrar' && <Cerrar id={data.id_caso} pend={data.pendientes_cierre} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'evidencia' && <RegistrarEvidenciaLazy idCaso={data.id_caso} onClose={() => setModal(null)} onDone={(idEvidencia) => { setModal(null); reload(); if (idEvidencia) nav('/evidencias/' + idEvidencia); }} />}
    </div>
  );
}

function Asignar({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data } = useLoad(() => api.get(`/casos/${id}/recolectores`), []);
  const { v, bind } = useForm({ id_usuario: '' });
  return (
    <Modal title="Asignar recolector" onClose={onClose} submitLabel="Asignar" onSubmit={async () => { await api.post(`/casos/${id}/asignar`, { id_usuario: Number(v.id_usuario) }); toast('Recolector asignado.'); onDone(); }}>
      <Field label="Recolector"><select {...bind('id_usuario')} required><option value="">Seleccione…</option>{data?.map((u: any) => <option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>)}</select></Field>
    </Modal>
  );
}
function Cerrar({ id, pend, onClose, onDone }: { id: number; pend: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ motivo: '' });
  return (
    <Modal title="Cerrar caso" danger submitLabel="Cerrar caso" onClose={onClose} onSubmit={async () => { await api.post(`/casos/${id}/estado`, { estado: 'cerrado', motivo: v.motivo }); toast('Caso cerrado y evidencias archivadas.'); onDone(); }}>
      <Notice tone="warn">El cierre es definitivo: el caso no se reabre y sus evidencias pasan a estado archivado. Los registros históricos se conservan.</Notice>
      {pend.length > 0 && <div className="spacer"><Notice tone="bad">Bloqueos actuales: {pend.join(', ')}.</Notice></div>}
      <div className="spacer"><Field label="Motivo documentado del cierre"><textarea {...bind('motivo')} required minLength={10} /></Field></div>
    </Modal>
  );
}
