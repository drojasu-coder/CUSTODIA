import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { dateFmt, ESTADO_ALERTA } from '../format';
import { Badge, Detail, Empty, ErrorBox, Field, Hash, Loading, Modal, Notice, PageHead, Pager, useForm, useLoad, useToast } from '../ui';

export default function Alertas() {
  const { can } = useAuth();
  const [page, setPage] = useState(1), [estado, setEstado] = useState(''), [sel, setSel] = useState<number | null>(null);
  const { data, error, reload } = useLoad(() => api.get('/alertas' + qs({ page, estado })), [page, estado]);
  return (
    <div className="stack">
      <PageHead title="Integridad y alertas" desc="Una discrepancia de hash genera una alerta. El Supervisor la revisa; se resuelve cuando una verificación posterior coincide con el hash inicial." />
      <section className="card">
        <div className="toolbar"><select className="control" value={estado} onChange={e => { setEstado(e.target.value); setPage(1); }} aria-label="Estado"><option value="">Todos los estados</option>{Object.entries(ESTADO_ALERTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        {error ? <ErrorBox e={error} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty icon="shield" title="Sin alertas" text="No hay alertas de integridad visibles." /> :
          <div className="table-wrap"><table><thead><tr><th>Código</th><th>Evidencia</th><th>Nivel</th><th>Estado</th><th>Generada</th><th>Descripción</th><th /></tr></thead>
            <tbody>{data.items.map((a: any) => <tr key={a.id_alerta}><td><strong>{a.codigo}</strong></td><td><Link to={'/evidencias/' + a.id_evidencia}><strong>{a.codigo_unico}</strong></Link><div className="small muted">{a.codigo_caso}</div></td>
              <td><span className={'badge ' + (a.nivel === 'critica' ? 'bad' : 'warn')}>{a.nivel}</span></td>
              <td><Badge map={ESTADO_ALERTA} v={a.estado} /></td><td>{dateFmt(a.fecha_generacion)}</td><td>{a.descripcion}</td><td><button className="btn mini" onClick={() => setSel(a.id_alerta)}>{can('revisar_alerta') && a.estado !== 'resuelta' ? 'Revisar' : 'Ver'}</button></td></tr>)}</tbody></table></div>}
        {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </section>
      {sel && <Detalle id={sel} onClose={() => setSel(null)} onChange={reload} />}
    </div>
  );
}
function Detalle({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.get('/alertas/' + id), [id]);
  const { v, bind, setV } = useForm({ notas: '' });
  return (
    <Modal wide title={data ? `${data.codigo} · ${data.codigo_unico}` : 'Alerta'} onClose={onClose} hideFoot>
      {error ? <ErrorBox e={error} /> : !data ? <Loading /> : <div className="stack">
        <Detail items={[['Estado', <Badge map={ESTADO_ALERTA} v={data.estado} />], ['Nivel', <span className={'badge ' + (data.nivel === 'critica' ? 'bad' : 'warn')}>{data.nivel}</span>], ['Generada', dateFmt(data.fecha_generacion)], ['Revisor', data.supervisor || '—'], ['Revisión', data.fecha_revision ? dateFmt(data.fecha_revision) : '—'], ['Resolución', data.fecha_resolucion ? dateFmt(data.fecha_resolucion) : '—']]} />
        {data.estado === 'resuelta' && (
          <Notice tone="good">
            <strong>Alerta resuelta:</strong> {data.resolucion || 'Resuelta tras verificación coincidente con el hash inicial.'}
          </Notice>
        )}
        <div className="hash-box">
          <div className="section-title">Hash esperado (inicial inmutable)</div>
          <Hash v={data.hash_esperado} />
          <div className="section-title spacer">Hash observado (discrepancia detectada)</div>
          <Hash v={data.hash_observado} />
        </div>
        <div className="row">
          <Link to={'/evidencias/' + data.id_evidencia} className="btn mini">Ver evidencia {data.codigo_unico}</Link>
        </div>
        <div><div className="section-title">Historial de la alerta</div>{data.historial.map((h: any) => <div className="list-row" key={h.id_historial}><div className="body"><strong>{h.accion}</strong><p className="small">{h.notas}</p><div className="small muted">{h.usuario} · {dateFmt(h.fecha)}</div></div></div>)}</div>
        {can('revisar_alerta') && data.estado !== 'resuelta' && <form onSubmit={async e => { e.preventDefault(); try { await api.post(`/alertas/${id}/revisar`, v); setV({ notas: '' }); toast(data.estado === 'pendiente' ? 'Alerta en revisión.' : 'Nota agregada.'); reload(); onChange(); } catch (x) { toast((x as Error).message, 'error'); } }}>
          <Field label={data.estado === 'pendiente' ? 'Iniciar revisión: nota del Supervisor' : 'Agregar nota de revisión'} hint="La alerta se resolverá cuando el Custodio o el Supervisor registre una verificación que coincida con el hash inicial."><textarea {...bind('notas')} required minLength={5} placeholder="Documente las acciones de investigación o verificación…" /></Field>
          <button className="btn primary">{data.estado === 'pendiente' ? 'Tomar en revisión' : 'Agregar nota'}</button></form>}
      </div>}
    </Modal>
  );
}
