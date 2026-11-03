import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { dateFmt, ESTADO_ALERTA, ESTADO_EVID, ESTADO_SOL, ESTADO_TRF, INTEGRIDAD, MODO_VER, sizeFmt, getSemaforoIntegridad } from '../format';
import { Badge, Detail, Empty, ErrorBox, Field, Hash, Icon, Loading, Modal, Notice, PageHead, Pager, SemaforoBadge, Tabs, useForm, useLoad, useToast } from '../ui';

export function Evidencias() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [page, setPage] = useState(1), [f, setF] = useState({ estado: '', integridad: '', q: '' });
  const [nuevo, setNuevo] = useState(false);
  const { data, error, reload } = useLoad(() => api.get('/evidencias' + qs({ page, ...f })), [page, f.estado, f.integridad, f.q]);
  const set = (k: string, v: string) => { setF(s => ({ ...s, [k]: v })); setPage(1); };
  return (
    <div className="stack">
      <PageHead title="Evidencias" desc="Cada evidencia tiene código único, huella SHA-256 inicial inmutable y un historial de custodia.">
        {can('registrar_evidencia') && <button className="btn primary" onClick={() => setNuevo(true)}><Icon n="plus" />Registrar evidencia</button>}
      </PageHead>
      <section className="card">
        <div className="toolbar"><input className="control" placeholder="Buscar por código, nombre o serie" value={f.q} onChange={e => set('q', e.target.value)} aria-label="Buscar" />
          <select className="control" value={f.estado} onChange={e => set('estado', e.target.value)} aria-label="Estado"><option value="">Todos los estados</option>{Object.entries(ESTADO_EVID).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <select className="control" value={f.integridad} onChange={e => set('integridad', e.target.value)} aria-label="Integridad"><option value="">Toda integridad</option>{Object.entries(INTEGRIDAD).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        {error ? <ErrorBox e={error} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty icon="drive" title="Sin evidencias" text="No hay evidencias visibles con ese filtro." /> :
          <div className="table-wrap"><table><thead><tr><th>Código</th><th>Referencia</th><th>Caso</th><th>Semáforo</th><th>Estado</th><th>Integridad</th><th>Custodio</th><th>Ubicación</th><th /></tr></thead>
            <tbody>{data.items.map((e: any) => <tr key={e.id_evidencia}><td><strong>{e.codigo_unico}</strong></td><td>{e.nombre_referencia}<div className="small muted">{e.tipo}</div></td><td>{e.codigo_caso}</td>
              <td><SemaforoBadge estado={e.estado} integridad={e.integridad} /></td>
              <td><Badge map={ESTADO_EVID} v={e.estado} /></td><td><Badge map={INTEGRIDAD} v={e.integridad} /></td><td>{e.custodio}</td><td>{e.ubicacion}</td>
              <td><button className="btn mini" onClick={() => nav('/evidencias/' + e.id_evidencia)}>Ver</button></td></tr>)}</tbody></table></div>}
        {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </section>
      {nuevo && <RegistrarEvidencia onClose={() => setNuevo(false)} onDone={(newId) => { setNuevo(false); reload(); if (newId) nav('/evidencias/' + newId); }} />}
    </div>
  );
}

export function RegistrarEvidencia({ idCaso, onClose, onDone }: { idCaso?: number; onClose: () => void; onDone: (idEvidencia?: number) => void }) {
  const toast = useToast();
  const tipos = useLoad(() => api.get('/catalogos/tipos-evidencia'), []);
  const ubs = useLoad(() => api.get('/catalogos/ubicaciones-activas'), []);
  const casos = useLoad(() => !idCaso ? api.get('/casos?size=100') : Promise.resolve({ items: [] }), [idCaso]);
  const [selectedCaso, setSelectedCaso] = useState<string>(idCaso ? String(idCaso) : '');
  const now = new Date(Date.now() - 6 * 3600_000 - 60_000).toISOString().slice(0, 16);   // hora de Guatemala (UTC-6)
  const { v, bind } = useForm({ id_tipo: '', nombre_referencia: '', descripcion: '', marca: '', modelo: '', numero_serie: '', capacidad_almacenamiento: '', estado_fisico: '', lugar_recoleccion: '', fecha_recoleccion: now, id_ubicacion: '', observaciones: '' });
  const FORMATOS_PERMITIDOS = '.txt,.log,.csv,.json,.xml,.pdf,.png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.webp,.heic,.mp4,.mov,.avi,.mkv,.mp3,.wav,.ogg,.m4a,.eml,.msg,.mbox,.pcap,.pcapng,.cap,.zip,.7z,.gz,.tgz,.tar,.rar,.e01,.ex01,.aff,.dd,.img,.raw,.iso,.bin,.mem,.dmp,.vmem,.lime,.evtx,.evt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.db,.sqlite,.sqlite3,.plist,.reg,.hive';
  const [file, setFile] = useState<File | null>(null);
  const casoFinal = idCaso ?? (selectedCaso ? Number(selectedCaso) : null);
  return (
    <Modal wide title="Registrar evidencia" submitLabel="Registrar y calcular hash" onClose={onClose} onSubmit={async () => {
      if (!casoFinal) throw new Error('Seleccione el caso asociado a la evidencia.');
      if (!file) throw new Error('Adjunte el archivo de la evidencia.');
      const fd = new FormData();
      Object.entries({ ...v, id_caso: casoFinal, fecha_recoleccion: new Date(v.fecha_recoleccion + ':00-06:00').toISOString() }).forEach(([k, x]) => { if (x !== '' && x != null) fd.append(k, String(x)); });
      fd.append('archivo', file);
      try {
        const e = await api.upload('/evidencias', fd);
        toast(`Evidencia ${e.codigo_unico} registrada. Hash inicial: ${(e.hash_inicial || e.sha256 || '').slice(0, 12)}…`);
        onDone(e.id_evidencia);
      } catch (err: any) {
        if (err.codigo === 'archivo_invalido') {
          throw new Error(`Archivo no válido: ${err.message}`);
        }
        throw err;
      }
    }}>
      <Notice>El servidor calcula la huella SHA-256 del archivo al registrarlo. Ese hash inicial no podrá modificarse. Use únicamente archivos ficticios.</Notice>
      {!idCaso && (
        <div className="spacer">
          <Field label="Caso al que pertenece"><select value={selectedCaso} onChange={e => setSelectedCaso(e.target.value)} required>
            <option value="">Seleccione el caso…</option>
            {casos.data?.items?.filter((c: any) => !['cerrado', 'archivado'].includes(c.estado)).map((c: any) => (
              <option key={c.id_caso} value={c.id_caso}>{c.codigo_caso} · {c.titulo}</option>
            ))}
          </select></Field>
        </div>
      )}
      <div className="spacer grid2">
        <Field label="Nombre de referencia"><input {...bind('nombre_referencia')} required minLength={3} /></Field>
        <Field label="Tipo de evidencia"><select {...bind('id_tipo')} required><option value="">Seleccione…</option>{tipos.data?.filter((t: any) => t.activo).map((t: any) => <option key={t.id_tipo} value={t.id_tipo}>{t.nombre}</option>)}</select></Field>
        <Field label="Marca"><input {...bind('marca')} /></Field><Field label="Modelo"><input {...bind('modelo')} /></Field>
        <Field label="Número de serie"><input {...bind('numero_serie')} /></Field><Field label="Capacidad"><input {...bind('capacidad_almacenamiento')} placeholder="Ej.: 1 TB" /></Field>
        <Field label="Estado físico"><input {...bind('estado_fisico')} /></Field>
        <Field label="Ubicación inicial"><select {...bind('id_ubicacion')} required><option value="">Seleccione…</option>{ubs.data?.map((u: any) => <option key={u.id_ubicacion} value={u.id_ubicacion} disabled={u.ocupacion >= u.capacidad}>{u.nombre} ({u.ocupacion}/{u.capacidad})</option>)}</select></Field>
        <Field label="Lugar de recolección"><input {...bind('lugar_recoleccion')} required /></Field>
        <Field label="Fecha y hora de recolección"><input type="datetime-local" {...bind('fecha_recoleccion')} max={now} required /></Field>
      </div>
      <Field label="Descripción"><textarea {...bind('descripcion')} required minLength={5} /></Field>
      <Field label="Observaciones"><textarea {...bind('observaciones')} style={{ minHeight: 60 }} /></Field>
      <Field label="Archivo de la evidencia" hint="Formatos admitidos: texto, imágenes, volcados forenses (.raw, .dd, .e01), capturas (.pcap), registros (.evtx, .reg) y archivos ofimáticos. No se admiten ejecutables.">
        <input type="file" accept={FORMATOS_PERMITIDOS} required onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </Field>
    </Modal>
  );
}

export function EvidenciaDetalle() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('general');
  const [modal, setModal] = useState<'verificar' | 'transferir' | 'solicitar' | null>(null);
  const { data: e, error, reload } = useLoad(() => api.get('/evidencias/' + id), [id]);
  const [qr, setQr] = useState('');
  useEffect(() => { let u = ''; api.blobUrl(`/evidencias/${id}/qr`).then(x => { u = x; setQr(x); }).catch(() => {}); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  if (error) return <ErrorBox e={error} />;
  if (!e) return <Loading />;
  const esCustodio = e.id_custodio_actual === user!.id;
  const activa = e.transferencias.some((t: any) => ['pendiente', 'autorizada'].includes(t.estado));
  const bloqueada = ['con_alerta', 'archivada'].includes(e.estado) || ['no_coincide', 'en_revision'].includes(e.integridad);
  const descargar = async () => {
    try { const h = await api.download(`/evidencias/${id}/original`, 'original'); toast(`Descarga registrada. SHA-256: ${h?.slice(0, 12)}…`); reload(); } catch (x) { toast((x as Error).message, 'error'); }
  };
  return (
    <div className="stack">
      <PageHead title={`${e.codigo_unico} · ${e.nombre_referencia}`} desc={`${e.tipo} · Caso ${e.codigo_caso}`}>
        <Link className="btn" to="/evidencias">Volver</Link>
        {can('descargar_original') && (user!.rol === 'Supervisor' || esCustodio) && <button className="btn" onClick={descargar}><Icon n="download" />Descargar original</button>}
        {e.puede_verificar && <button className="btn" onClick={() => setModal('verificar')}><Icon n="shield" />Verificar integridad</button>}
        {can('transferir_custodia') && esCustodio && !activa && !bloqueada && e.estado_caso !== 'cerrado' && <button className="btn primary" onClick={() => setModal('transferir')}><Icon n="transfer" />Entregar custodia</button>}
        {can('solicitar_acceso') && e.estado_caso !== 'cerrado' && <button className="btn" onClick={() => setModal('solicitar')}><Icon n="key" />Solicitar copia</button>}
      </PageHead>
      {bloqueada && e.estado !== 'archivada' && <Notice tone="bad">La evidencia tiene una discrepancia de integridad sin resolver. No puede transferirse ni emitirse copias hasta que el Supervisor la revise y una verificación posterior coincida.</Notice>}
      <section className="card">
        <div className="row wrap-mobile" style={{ alignItems: 'flex-start', gap: 22 }}>
          <div className="qr" aria-label="Código QR" style={{ textAlign: 'center' }}>
            {qr && <img src={qr} alt={`QR ${e.codigo_unico}`} style={{ width: '100%', display: 'block', borderRadius: 6 }} />}
            {qr && <a className="btn mini ghost" href={qr} download={`QR_${e.codigo_unico}.svg`} style={{ marginTop: 8, width: '100%', fontSize: 11 }}><Icon n="download" />Guardar QR</a>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Detail items={[
              ['Semáforo', <SemaforoBadge estado={e.estado} integridad={e.integridad} />],
              ['Estado', <Badge map={ESTADO_EVID} v={e.estado} />],
              ['Integridad', <Badge map={INTEGRIDAD} v={e.integridad} />],
              ['Custodio actual', e.custodio],
              ['Ubicación', e.ubicacion],
              ['Recolector', e.recolector],
              ['Recolectada', dateFmt(e.fecha_recoleccion)],
            ]} />
            <div className="hash-box spacer">
              <div className="section-title">Hash inicial SHA-256 (inmutable)</div>
              <Hash v={e.hash_inicial} />
              {e.hash_ultima_verificacion && <>
                <div className="section-title spacer">Última verificación</div>
                <Hash v={e.hash_ultima_verificacion} />
              </>}
            </div>
          </div>
        </div>
      </section>
      <div className="semaforo-card">
        <div className="semaforo-card-head">
          <div>
            <strong>Evaluación de integridad en cadena de custodia</strong>
            <div className="small muted">Control en tiempo real según el protocolo forense y huella digital SHA-256</div>
          </div>
          <SemaforoBadge estado={e.estado} integridad={e.integridad} />
        </div>
        <p className="small muted">{getSemaforoIntegridad(e.estado, e.integridad).desc}</p>
      </div>
      <Tabs active={tab} onChange={setTab} tabs={[['general', 'General'], ['archivos', 'Archivo y copias'], ['custodia', 'Custodia'], ['integridad', 'Integridad'], ['accesos', 'Accesos y análisis'], ['linea', 'Línea de tiempo']]} />
      {tab === 'general' && <section className="card"><Detail items={[['Marca', e.marca], ['Modelo', e.modelo], ['Serie', e.numero_serie], ['Capacidad', e.capacidad_almacenamiento], ['Estado físico', e.estado_fisico], ['Lugar de recolección', e.lugar_recoleccion]]} />
        <div className="spacer"><div className="section-title">Descripción</div><p>{e.descripcion}</p></div>{e.observaciones && <div className="spacer"><div className="section-title">Observaciones</div><p>{e.observaciones}</p></div>}</section>}
      {tab === 'archivos' && <section className="card">{e.archivos.length === 0 ? <Empty icon="image" title="Sin archivos" /> : <div className="grid3">{e.archivos.map((a: any) => <div className="file-card" key={a.id_archivo}><Icon n="drive" /><h3>{a.nombre_original}</h3><div className="small muted">{sizeFmt(a.tamano_bytes)} · {dateFmt(a.fecha_carga)}</div><div className="mono break spacer">{a.hash_sha256}</div></div>)}</div>}
        <div className="spacer"><Notice>El original no se entrega a analistas: ellos trabajan sobre una copia autorizada con el mismo hash.</Notice></div></section>}
      {tab === 'custodia' && <section className="card"><div className="card-head"><h2>Historial de custodia</h2></div><div className="table-wrap"><table><thead><tr><th>Custodio</th><th>Ubicación</th><th>Desde</th><th>Hasta</th><th /></tr></thead>
        <tbody>{e.custodia.map((c: any) => <tr key={c.id_custodia}><td>{c.custodio}</td><td>{c.ubicacion}</td><td>{dateFmt(c.fecha_inicio)}</td><td>{dateFmt(c.fecha_fin)}</td><td>{c.es_custodia_actual && <span className="badge good">Actual</span>}</td></tr>)}</tbody></table></div>
        <div className="card-head spacer"><h2>Transferencias</h2></div>{e.transferencias.length === 0 ? <Empty icon="transfer" title="Sin transferencias" /> : <div className="table-wrap"><table><thead><tr><th>Código</th><th>De → A</th><th>Destino</th><th>Estado</th><th>Entrega</th><th>Recepción</th></tr></thead>
          <tbody>{e.transferencias.map((t: any) => <tr key={t.id_transferencia}><td><strong>{t.codigo}</strong></td><td>{t.entregante} → {t.receptor}</td><td>{t.ubicacion_destino}</td><td><Badge map={ESTADO_TRF} v={t.estado} /></td><td>{dateFmt(t.fecha_entrega)}</td><td>{dateFmt(t.fecha_recepcion)}</td></tr>)}</tbody></table></div>}</section>}
      {tab === 'integridad' && <section className="card"><div className="card-head"><h2>Verificaciones</h2></div><div className="table-wrap"><table><thead><tr><th>Código</th><th>Fecha</th><th>Modo</th><th>Resultado</th><th>Hash obtenido</th><th>Por</th></tr></thead>
        <tbody>{e.verificaciones.map((v: any) => <tr key={v.id_registro_hash}><td><strong>{v.codigo ?? 'Inicial'}</strong></td><td>{dateFmt(v.fecha_calculo)}</td><td>{MODO_VER[v.modo]}</td>
          <td>{v.resultado === 'coincide' ? <span className="badge good">Coincide</span> : v.resultado === 'no_coincide' ? <span className="badge bad">No coincide</span> : <span className="badge">Registro inicial</span>}</td><td><Hash v={v.valor_hash} /></td><td>{v.usuario}</td></tr>)}</tbody></table></div>
        {e.alertas.length > 0 && <><div className="card-head spacer"><h2>Alertas</h2></div>{e.alertas.map((a: any) => <div className="list-row" key={a.id_alerta}><Icon n="alert" /><div className="body"><strong>{a.codigo}</strong> <Badge map={ESTADO_ALERTA} v={a.estado} /><div className="small muted">{a.descripcion}</div></div></div>)}</>}</section>}
      {tab === 'accesos' && <section className="card"><div className="card-head"><h2>Solicitudes de acceso</h2></div>{e.solicitudes.length === 0 ? <Empty icon="key" title="Sin solicitudes" /> : <div className="table-wrap"><table><thead><tr><th>Código</th><th>Solicitante</th><th>Estado</th><th>Vence</th><th>Motivo</th></tr></thead>
        <tbody>{e.solicitudes.map((s: any) => <tr key={s.id_solicitud}><td><strong>{s.codigo}</strong></td><td>{s.solicitante}</td><td><Badge map={ESTADO_SOL} v={s.estado} /></td><td>{s.fecha_vencimiento?.slice(0, 10)}</td><td>{s.motivo}</td></tr>)}</tbody></table></div>}
        <div className="card-head spacer"><h2>Análisis forenses</h2></div>{e.analisis.length === 0 ? <Empty icon="flask" title="Sin análisis visibles" /> : e.analisis.map((a: any) => <div className="list-row" key={a.id_analisis}><Icon n="flask" /><div className="body"><strong>{a.codigo}</strong><div className="small muted">{a.analista} · {dateFmt(a.fecha_registro)} · {a.proposito}</div></div></div>)}</section>}
      {tab === 'linea' && <section className="card"><div className="timeline">{e.eventos.map((v: any) => <div className="timeline-item" key={v.id_evento}><strong>{v.accion}</strong><div className="small muted">{dateFmt(v.fecha)} · {v.nombre_usuario_hist} ({v.rol_hist})</div><p>{v.detalle}</p></div>)}</div></section>}
      {modal === 'verificar' && <Verificar id={e.id_evidencia} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'transferir' && <Transferir id={e.id_evidencia} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'solicitar' && <SolicitarCopia codigo={e.codigo_unico} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </div>
  );
}

function SolicitarCopia({ codigo, onClose, onDone }: { codigo: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ motivo: '' });
  return (
    <Modal title={`Solicitar copia de trabajo · ${codigo}`} submitLabel="Enviar solicitud" onClose={onClose} onSubmit={async () => {
      const s = await api.post('/solicitudes', { codigo_evidencia: codigo, motivo: v.motivo });
      toast(`Solicitud ${s.codigo} enviada al Supervisor.`);
      onDone();
    }}>
      <Notice>Se solicitará una copia de trabajo autorizada para fines de peritaje forense. El archivo original nunca se entrega.</Notice>
      <div className="spacer">
        <Field label="Motivo del análisis forense"><textarea {...bind('motivo')} required minLength={10} maxLength={250} placeholder="Describa el objetivo del análisis pericial solicitado…" /></Field>
      </div>
    </Modal>
  );
}

function Verificar({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ modo: 'almacenado', hash_externo: '', observaciones: '' });
  return (
    <Modal title="Verificar integridad de la evidencia" submitLabel="Ejecutar verificación" onClose={onClose} onSubmit={async () => {
      const r = await api.post(`/evidencias/${id}/verificar`, { modo: v.modo, hash_externo: v.hash_externo || undefined, observaciones: v.observaciones || undefined });
      toast(r.coincide ? (r.alerta_resuelta ? 'Integridad verificada: la alerta pendiente fue resuelta.' : 'Integridad confirmada: el hash coincide con el hash inicial inmutable.') : `Discrepancia detectada. Se generó la alerta ${r.alerta.codigo}.`, r.coincide ? 'ok' : 'error'); onDone();
    }}>
      <Field label="Modo de verificación"><select {...bind('modo')}>
        <option value="almacenado">Comprobación real del archivo físico/almacenado</option>
        <option value="externo">Comparar contra un hash SHA-256 externo</option>
        <option value="simulacion">[Simulación académica] Forzar discrepancia deliberada</option>
      </select></Field>
      {v.modo === 'almacenado' && <Notice tone="good"><strong>Comprobación real:</strong> El servidor leerá el archivo original binario almacenado en la base de datos y recalculará su hash SHA-256 real para verificarlo contra el registro inicial.</Notice>}
      {v.modo === 'externo' && <Field label="Hash SHA-256 a comparar" hint="64 caracteres hexadecimales de la imagen o archivo testigo."><input {...bind('hash_externo')} className="mono" required /></Field>}
      {v.modo === 'simulacion' && <Notice tone="warn"><strong>Simulación didáctica:</strong> No altera el archivo real. Genera una discrepancia intencional para demostrar la regla RN-24, disparando la alerta de integridad crítica y activando el semáforo rojo para revisión del Supervisor.</Notice>}
      <div className="spacer"><Field label="Observaciones periciales"><textarea {...bind('observaciones')} style={{ minHeight: 60 }} placeholder="Documente las condiciones o motivo de la verificación…" /></Field></div>
    </Modal>
  );
}

function Transferir({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const rec = useLoad(() => api.get('/transferencias/receptores'), []);
  const ubs = useLoad(() => api.get('/catalogos/ubicaciones-activas'), []);
  const { v, bind } = useForm({ id_receptor: '', id_ubicacion_destino: '', motivo: '', firma: false });
  return (
    <Modal title="Entregar custodia" submitLabel="Firmar y entregar" onClose={onClose} onSubmit={async () => {
      if (!v.firma) throw new Error('Debe marcar la casilla de confirmación con firma simulada.');
      const t = await api.post('/transferencias', { id_evidencia: id, id_receptor: Number(v.id_receptor), id_ubicacion_destino: Number(v.id_ubicacion_destino), motivo: v.motivo, confirmo_firma: v.firma });
      toast(`Transferencia ${t.codigo} creada; espera autorización del Supervisor.`); onDone();
    }}>
      <Field label="Receptor (Custodio)"><select {...bind('id_receptor')} required><option value="">Seleccione…</option>{rec.data?.map((u: any) => <option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>)}</select></Field>
      <Field label="Ubicación de destino"><select {...bind('id_ubicacion_destino')} required><option value="">Seleccione…</option>{ubs.data?.map((u: any) => <option key={u.id_ubicacion} value={u.id_ubicacion} disabled={u.ocupacion >= u.capacidad}>{u.nombre} ({u.ocupacion}/{u.capacidad})</option>)}</select></Field>
      <Field label="Motivo"><textarea {...bind('motivo')} required minLength={5} maxLength={250} style={{ minHeight: 64 }} /></Field>
      <label className="row"><input type="checkbox" checked={v.firma} onChange={e => (bind('firma').onChange as any)(e)} /> Confirmo la entrega con mi firma <strong>simulada</strong> (sin valor jurídico).</label>
    </Modal>
  );
}
