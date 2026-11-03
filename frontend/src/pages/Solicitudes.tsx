import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { dateFmt, ESTADO_SOL } from '../format';
import { Badge, Empty, ErrorBox, Field, Icon, Loading, Modal, Notice, PageHead, Pager, useForm, useLoad, useToast } from '../ui';

export default function Solicitudes() {
  const { can } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1), [estado, setEstado] = useState(''), [nueva, setNueva] = useState(false), [dec, setDec] = useState<any>(null);
  const { data, error, reload } = useLoad(() => api.get('/solicitudes' + qs({ page, estado })), [page, estado]);
  const bajar = async (s: any) => { try { const h = await api.download(`/solicitudes/${s.id_solicitud}/copia`, 'copia'); toast(`Copia descargada. SHA-256: ${h?.slice(0, 12)}…`); } catch (e) { toast((e as Error).message, 'error'); } };
  return (
    <div className="stack">
      <PageHead title="Solicitudes de acceso" desc="El análisis se hace solo sobre copias autorizadas, con vigencia y aprobación del Supervisor.">
        {can('solicitar_acceso') && <button className="btn primary" onClick={() => setNueva(true)}><Icon n="plus" />Solicitar acceso</button>}
      </PageHead>
      <section className="card">
        <div className="toolbar"><select className="control" value={estado} onChange={e => { setEstado(e.target.value); setPage(1); }} aria-label="Estado"><option value="">Todos los estados</option>{Object.entries(ESTADO_SOL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        {error ? <ErrorBox e={error} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty icon="key" title="Sin solicitudes" /> :
          <div className="table-wrap"><table><thead><tr><th>Código</th><th>Evidencia</th><th>Solicitante</th><th>Estado</th><th>Vence</th><th>Motivo</th><th /></tr></thead>
            <tbody>{data.items.map((s: any) => <tr key={s.id_solicitud}><td><strong>{s.codigo}</strong><div className="small muted">{dateFmt(s.fecha_solicitud)}</div></td>
              <td><Link to={'/evidencias/' + s.id_evidencia}><strong>{s.codigo_unico}</strong></Link><div className="small muted">{s.codigo_caso}</div>{s.codigo_copia && <div className="small mono text-blue">{s.codigo_copia}</div>}</td>
              <td>{s.solicitante}</td>
              <td><Badge map={ESTADO_SOL} v={s.estado} />{s.estado === 'aprobada' && !s.vigente && <div className="small muted">Vigencia expirada</div>}</td><td>{s.fecha_vencimiento?.slice(0, 10)}</td>
              <td>{s.motivo}{s.observaciones_supervisor && <div className="small muted">Supervisor: {s.observaciones_supervisor}</div>}</td>
              <td><div className="row gap-sm wrap">
                {can('decidir_solicitud') && s.estado === 'pendiente' && <button className="btn mini primary" onClick={() => setDec(s)}>Resolver</button>}
                {can('descargar_copia') && s.vigente && s.id_copia && <button className="btn mini" onClick={() => bajar(s)}><Icon n="download" />Copia</button>}
                {s.vigente && can('registrar_analisis') && <Link className="btn mini" to={'/analisis?nueva=' + s.id_solicitud}>Registrar análisis</Link>}
              </div></td></tr>)}</tbody></table></div>}
        {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </section>
      {nueva && <Nueva onClose={() => setNueva(false)} onDone={() => { setNueva(false); reload(); }} />}
      {dec && <Decidir s={dec} onClose={() => setDec(null)} onDone={() => { setDec(null); reload(); }} />}
    </div>
  );
}
function Nueva({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const evs = useLoad(() => api.get('/evidencias?size=100'), []);
  const { v, bind } = useForm({ codigo_evidencia: '', motivo: '' });
  return <Modal title="Solicitar acceso a una evidencia" submitLabel="Enviar solicitud" onClose={onClose} onSubmit={async () => { const s = await api.post('/solicitudes', v); toast(`Solicitud ${s.codigo} enviada.`); onDone(); }}>
    <Notice>Indique el código de la evidencia. El análisis se realiza sobre una copia forense autorizada: el original permanece protegido.</Notice>
    <div className="spacer">
      <Field label="Código de evidencia">
        <input {...bind('codigo_evidencia')} list="evidencias-list" placeholder="Ej.: EVI-2026-014" required />
        <datalist id="evidencias-list">
          {evs.data?.items?.map((e: any) => (
            <option key={e.id_evidencia} value={e.codigo_unico}>{e.nombre_referencia} ({e.codigo_caso})</option>
          ))}
        </datalist>
      </Field>
    </div>
    <Field label="Motivo de la solicitud"><textarea {...bind('motivo')} required minLength={10} maxLength={250} placeholder="Describa el alcance y justificación del análisis pericial requerido…" /></Field></Modal>;
}
function Decidir({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ observaciones: '' });
  const go = (decision: 'aprobar' | 'rechazar') => async () => {
    if (v.observaciones.trim().length < 5) return toast('Documente su decisión con al menos 5 caracteres.', 'error');
    const r = await api.post(`/solicitudes/${s.id_solicitud}/decidir`, { decision, observaciones: v.observaciones });
    toast(decision === 'aprobar' ? `Aprobada. Copia ${r.copia}.` : 'Solicitud rechazada.');
    onDone();
  };
  return <Modal title={`Resolver ${s.codigo}`} onClose={onClose} hideFoot onSubmit={go('aprobar')}>
    <p><strong>{s.solicitante}</strong> solicita copia de <strong>{s.codigo_unico}</strong> hasta {s.fecha_vencimiento?.slice(0, 10)}.</p><p className="muted spacer">{s.motivo}</p>
    <div className="spacer"><Field label="Observaciones de la decisión"><textarea {...bind('observaciones')} required minLength={5} placeholder="Documente la justificación de la aprobación o motivo de rechazo…" /></Field></div>
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button type="button" className="btn" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn danger" onClick={() => go('rechazar')().catch(e => toast(e.message, 'error'))}>Rechazar</button><button className="btn success">Aprobar y emitir copia</button></div></Modal>;
}
