import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { dateFmt, ESTADO_TRF } from '../format';
import { Badge, Detail, Empty, ErrorBox, Field, Icon, Loading, Modal, Notice, PageHead, Pager, useAction, useForm, useLoad, useToast } from '../ui';

export default function Custodia() {
  const { user, can } = useAuth();
  const run = useAction();
  const [page, setPage] = useState(1), [estado, setEstado] = useState('');
  const [rechazo, setRechazo] = useState<any>(null), [recibir, setRecibir] = useState<any>(null), [ver, setVer] = useState<any>(null);
  const [nueva, setNueva] = useState(false);
  const { data, error, reload } = useLoad(() => api.get('/transferencias' + qs({ page, estado })), [page, estado]);

  return (
    <div className="stack">
      <PageHead title="Custodia y transferencias" desc="Entrega por el responsable actual, autorización del Supervisor y recepción por el receptor asignado. Las firmas son simuladas.">
        {can('transferir_custodia') && <button className="btn primary" onClick={() => setNueva(true)}><Icon n="plus" />Nueva transferencia</button>}
      </PageHead>
      <section className="card">
        <div className="toolbar"><select className="control" value={estado} onChange={e => { setEstado(e.target.value); setPage(1); }} aria-label="Estado"><option value="">Todos los estados</option>{Object.entries(ESTADO_TRF).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        {error ? <ErrorBox e={error} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty icon="transfer" title="Sin transferencias" text="No hay registros con ese filtro. Si es custodio, puede iniciar una entrega con «Nueva transferencia»." /> :
          <div className="table-wrap"><table><thead><tr><th>Código</th><th>Evidencia</th><th>Entrega → Recibe</th><th>Destino</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead>
            <tbody>{data.items.map((t: any) => <tr key={t.id_transferencia}><td><strong>{t.codigo}</strong></td><td><Link to={'/evidencias/' + t.id_evidencia}>{t.codigo_unico}</Link><div className="small muted">{t.codigo_caso}</div></td>
              <td>{t.entregante} → {t.receptor}{t.autorizador && <div className="small muted">Autorizó: {t.autorizador}</div>}</td><td>{t.ubicacion_destino}</td><td><Badge map={ESTADO_TRF} v={t.estado} /></td><td>{dateFmt(t.fecha_entrega)}</td>
              <td><div className="row gap-sm wrap">
                <button className="btn mini" onClick={() => setVer(t)}>Ver</button>
                {can('autorizar_transferencia') && t.estado === 'pendiente' && <><button className="btn mini success" onClick={() => run(() => api.post(`/transferencias/${t.id_transferencia}/autorizar`, {}), 'Transferencia autorizada.', reload)}>Autorizar</button><button className="btn mini danger" onClick={() => setRechazo(t)}>Rechazar</button></>}
                {can('recibir_custodia') && t.estado === 'autorizada' && t.id_receptor === user!.id && <button className="btn mini primary" onClick={() => setRecibir(t)}>Confirmar recepción</button>}
                {t.id_entregante === user!.id && ['pendiente', 'autorizada'].includes(t.estado) && <button className="btn mini" onClick={() => run(() => api.post(`/transferencias/${t.id_transferencia}/cancelar`), 'Transferencia cancelada.', reload)}>Cancelar</button>}
              </div></td></tr>)}</tbody></table></div>}
        {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </section>
      {nueva && <NuevaTransferencia onClose={() => setNueva(false)} onDone={() => { setNueva(false); reload(); }} />}
      {ver && <DetalleTransferencia t={ver} onClose={() => setVer(null)} />}
      {rechazo && <Rechazar t={rechazo} onClose={() => setRechazo(null)} onDone={() => { setRechazo(null); reload(); }} />}
      {recibir && <Modal title={`Recepción de ${recibir.codigo_unico}`} submitLabel="Firmar y recibir" onClose={() => setRecibir(null)} onSubmit={async () => { await api.post(`/transferencias/${recibir.id_transferencia}/recibir`, { confirmo_firma: true }); setRecibir(null); reload(); }}>
        <p>Al confirmar, usted pasa a ser el custodio actual de <strong>{recibir.codigo_unico}</strong> en <strong>{recibir.ubicacion_destino}</strong>. La confirmación usa una firma simulada sin efectos jurídicos.</p></Modal>}
    </div>
  );
}

function NuevaTransferencia({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const evs = useLoad(() => api.get('/evidencias?size=100'), []);
  const rec = useLoad(() => api.get('/transferencias/receptores'), []);
  const ubs = useLoad(() => api.get('/catalogos/ubicaciones-activas'), []);
  const { v, bind } = useForm({ id_evidencia: '', id_receptor: '', id_ubicacion_destino: '', motivo: '', firma: false });

  const misEvidencias = evs.data?.items?.filter((e: any) =>
    e.custodio === user?.nombre && !['con_alerta', 'archivada'].includes(e.estado) && !['no_coincide', 'en_revision'].includes(e.integridad)
  ) ?? [];

  return (
    <Modal title="Entregar custodia de evidencia" submitLabel="Firmar y registrar entrega" onClose={onClose} onSubmit={async () => {
      if (!v.firma) throw new Error('Debe marcar la casilla de confirmación con firma simulada.');
      const t = await api.post('/transferencias', {
        id_evidencia: Number(v.id_evidencia),
        id_receptor: Number(v.id_receptor),
        id_ubicacion_destino: Number(v.id_ubicacion_destino),
        motivo: v.motivo,
        confirmo_firma: v.firma
      });
      toast(`Transferencia ${t.codigo} creada; espera autorización del Supervisor.`);
      onDone();
    }}>
      <Notice>La transferencia requiere autorización del Supervisor y posterior confirmación de recepción por el custodio receptor.</Notice>
      <div className="spacer">
        <Field label="Evidencia a transferir"><select {...bind('id_evidencia')} required>
          <option value="">Seleccione una evidencia bajo su custodia…</option>
          {misEvidencias.map((e: any) => (
            <option key={e.id_evidencia} value={e.id_evidencia}>{e.codigo_unico} · {e.nombre_referencia} ({e.codigo_caso})</option>
          ))}
        </select></Field>
        {misEvidencias.length === 0 && evs.data && (
          <p className="small muted">No tiene evidencias activas disponibles para entregar en este momento.</p>
        )}
      </div>
      <div className="grid2">
        <Field label="Custodio receptor"><select {...bind('id_receptor')} required><option value="">Seleccione…</option>{rec.data?.map((u: any) => <option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>)}</select></Field>
        <Field label="Ubicación de destino"><select {...bind('id_ubicacion_destino')} required><option value="">Seleccione…</option>{ubs.data?.map((u: any) => <option key={u.id_ubicacion} value={u.id_ubicacion} disabled={u.ocupacion >= u.capacidad}>{u.nombre} ({u.ocupacion}/{u.capacidad})</option>)}</select></Field>
      </div>
      <Field label="Motivo de la transferencia"><textarea {...bind('motivo')} required minLength={5} maxLength={250} placeholder="Indique la justificación de la entrega de custodia…" /></Field>
      <label className="row" style={{ marginTop: 8 }}><input type="checkbox" checked={v.firma} onChange={e => (bind('firma').onChange as any)(e)} /> Confirmo la entrega con mi firma <strong>simulada</strong> (sin valor legal).</label>
    </Modal>
  );
}

function DetalleTransferencia({ t, onClose }: { t: any; onClose: () => void }) {
  const { data, error } = useLoad(() => api.get('/transferencias/' + t.id_transferencia), [t.id_transferencia]);
  return (
    <Modal wide title={`Transferencia ${t.codigo}`} onClose={onClose} hideFoot>
      {error ? <ErrorBox e={error} /> : !data ? <Loading /> : (
        <div className="stack">
          <Detail items={[
            ['Código', data.codigo],
            ['Evidencia', data.codigo_unico],
            ['Caso', data.codigo_caso],
            ['Estado', <Badge map={ESTADO_TRF} v={data.estado} />],
            ['Entregado por', data.entregante],
            ['Receptor asignado', data.receptor],
            ['Ubicación de destino', data.ubicacion_destino],
            ['Fecha de entrega', dateFmt(data.fecha_entrega)],
            ['Autorizador', data.autorizador || '—'],
            ['Fecha de autorización', data.fecha_autorizacion ? dateFmt(data.fecha_autorizacion) : '—'],
            ['Fecha de recepción', data.fecha_recepcion ? dateFmt(data.fecha_recepcion) : '—'],
          ]} />
          <div className="spacer">
            <div className="section-title">Motivo</div>
            <p>{data.motivo}</p>
          </div>
          {data.observaciones && (
            <div className="spacer">
              <div className="section-title">Observaciones de supervisión</div>
              <p>{data.observaciones}</p>
            </div>
          )}
          <div className="spacer grid2">
            <div className="card" style={{ padding: 14 }}>
              <div className="section-title">Firma del entregante</div>
              <div className="mono small">{data.firma_entregante || '—'}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="section-title">Firma del receptor</div>
              <div className="mono small">{data.firma_receptor || (data.estado === 'recibida' ? 'Confirmada' : 'Pendiente de recepción')}</div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Rechazar({ t, onClose, onDone }: { t: any; onClose: () => void; onDone: () => void }) {
  const { v, bind } = useForm({ observaciones: '' });
  return <Modal title={`Rechazar ${t.codigo}`} danger submitLabel="Rechazar" onClose={onClose} onSubmit={async () => { await api.post(`/transferencias/${t.id_transferencia}/rechazar`, v); onDone(); }}>
    <Field label="Motivo del rechazo"><textarea {...bind('observaciones')} required minLength={5} /></Field></Modal>;
}
