import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { dateFmt } from '../format';
import { Detail, Empty, ErrorBox, Field, Icon, Loading, Modal, Notice, PageHead, Pager, useForm, useLoad, useToast } from '../ui';

export default function Analisis() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(1), [ver, setVer] = useState<number | null>(null), [nueva, setNueva] = useState(false);
  const { data, error, reload } = useLoad(() => api.get('/analisis' + qs({ page })), [page]);
  const vigentes = useLoad(() => can('registrar_analisis') ? api.get('/solicitudes?estado=aprobada&size=100') : Promise.resolve({ items: [] }), []);
  useEffect(() => { if (sp.get('nueva')) setNueva(true); }, [sp]);
  return (
    <div className="stack">
      <PageHead title="Análisis forense" desc="Los análisis se registran sobre copias autorizadas y no se editan: las aclaraciones se agregan como notas.">
        {can('registrar_analisis') && <button className="btn primary" onClick={() => setNueva(true)}><Icon n="plus" />Registrar análisis</button>}
      </PageHead>
      <section className="card">
        {error ? <ErrorBox e={error} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty icon="flask" title="Sin análisis registrados" /> :
          <div className="table-wrap"><table><thead><tr><th>Código</th><th>Evidencia</th><th>Analista</th><th>Propósito</th><th>Periodo</th><th /></tr></thead>
            <tbody>{data.items.map((a: any) => <tr key={a.id_analisis}><td><strong>{a.codigo}</strong></td><td>{a.codigo_unico}<div className="small muted">{a.codigo_caso}</div></td><td>{a.analista}</td><td>{a.proposito}</td><td>{a.fecha_inicio?.slice(0, 10)} → {a.fecha_fin?.slice(0, 10)}</td>
              <td><button className="btn mini" onClick={() => setVer(a.id_analisis)}>Ver</button></td></tr>)}</tbody></table></div>}
        {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </section>
      {ver && <Ver id={ver} onClose={() => setVer(null)} />}
      {nueva && <Nuevo solicitudes={vigentes.data?.items.filter((s: any) => s.vigente && s.id_copia) ?? []} inicial={sp.get('nueva')} onClose={() => { setNueva(false); setSp({}); }} onDone={() => { setNueva(false); setSp({}); reload(); }} />}
    </div>
  );
}

function Nuevo({ solicitudes, inicial, onClose, onDone }: { solicitudes: any[]; inicial: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const { v, bind, setV } = useForm({ id_solicitud: inicial ?? '', proposito: '', actividad_realizada: '', herramientas: '', resultado: '', conclusiones: '', fecha_inicio: today, fecha_fin: today, observaciones: '' });
  useEffect(() => {
    if (inicial) setV(s => ({ ...s, id_solicitud: inicial }));
  }, [inicial, setV]);
  return (
    <Modal wide title="Registrar análisis forense" submitLabel="Registrar" onClose={onClose} onSubmit={async () => {
      const a = await api.post('/analisis', { ...v, id_solicitud: Number(v.id_solicitud), observaciones: v.observaciones || undefined }); toast(`Análisis ${a.codigo} registrado.`); onDone();
    }}>
      {solicitudes.length === 0 && <Notice tone="warn">No tiene solicitudes aprobadas y vigentes con copia autorizada para registrar análisis.</Notice>}
      <div className="spacer"><Field label="Solicitud aprobada"><select {...bind('id_solicitud')} required><option value="">Seleccione…</option>{solicitudes.map(s => <option key={s.id_solicitud} value={s.id_solicitud}>{s.codigo} · {s.codigo_unico} (vence {s.fecha_vencimiento?.slice(0, 10)})</option>)}</select></Field></div>
      <Field label="Propósito del análisis"><input {...bind('proposito')} required minLength={5} placeholder="Ej.: Extracción de registros de eventos y verificación de integridad" /></Field>
      <Field label="Actividad realizada"><textarea {...bind('actividad_realizada')} required minLength={10} placeholder="Describa el procedimiento pericial aplicado sobre la copia forense…" /></Field>
      <div className="grid2"><Field label="Herramientas utilizadas"><input {...bind('herramientas')} required placeholder="Ej.: Autopsy 4.21, FTK Imager, sha256sum" /></Field><div className="grid2"><Field label="Fecha de inicio"><input type="date" {...bind('fecha_inicio')} required /></Field><Field label="Fecha de conclusión"><input type="date" {...bind('fecha_fin')} required /></Field></div></div>
      <Field label="Hallazgos periciales"><textarea {...bind('resultado')} required minLength={10} placeholder="Detalle los hallazgos técnicos identificados…" /></Field>
      <Field label="Conclusiones"><textarea {...bind('conclusiones')} required minLength={10} placeholder="Conclusiones del peritaje forense digital…" /></Field>
      <Field label="Observaciones complementarias"><textarea {...bind('observaciones')} style={{ minHeight: 60 }} placeholder="Notas adicionales opcionales…" /></Field>
    </Modal>
  );
}
function Ver({ id, onClose }: { id: number; onClose: () => void }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.get('/analisis/' + id), [id]);
  const { v, bind, setV } = useForm({ texto: '' });
  return (
    <Modal wide title={data ? `${data.codigo} · ${data.codigo_unico}` : 'Análisis'} onClose={onClose} hideFoot>
      {error ? <ErrorBox e={error} /> : !data ? <Loading /> : <div className="stack">
        <Detail items={[['Analista', data.analista], ['Solicitud', data.codigo_solicitud], ['Copia', data.codigo_copia], ['Inicio', data.fecha_inicio?.slice(0, 10)], ['Fin', data.fecha_fin?.slice(0, 10)], ['Registrado', dateFmt(data.fecha_registro)]]} />
        {([['Propósito', data.proposito], ['Actividad', data.actividad_realizada], ['Herramientas', data.herramientas], ['Hallazgos', data.resultado], ['Conclusiones', data.conclusiones]] as [string, string][]).map(([l, t]) => <div key={l}><div className="section-title">{l}</div><p>{t}</p></div>)}
        <div><div className="section-title">Notas complementarias</div>{data.notas.length === 0 ? <p className="muted">Sin notas.</p> : data.notas.map((n: any) => <div className="list-row" key={n.id_nota}><div className="body"><p>{n.texto}</p><div className="small muted">{n.usuario} · {dateFmt(n.fecha)}</div></div></div>)}</div>
        {can('registrar_analisis') && data.id_analista === user!.id && <div className="row" style={{ alignItems: 'flex-start' }}><textarea className="control" placeholder="Agregar nota complementaria" value={v.texto} onChange={e => setV({ texto: e.target.value })} aria-label="Nota" />
          <button type="button" className="btn primary" disabled={v.texto.trim().length < 5} onClick={async () => { try { await api.post(`/analisis/${id}/notas`, { texto: v.texto }); setV({ texto: '' }); toast('Nota agregada.'); reload(); } catch (e) { toast((e as Error).message, 'error'); } }}>Agregar</button></div>}
      </div>}
    </Modal>
  );
}
