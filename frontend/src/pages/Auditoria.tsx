import { useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { dateFmt, RESULTADO_AUD } from '../format';
import { Badge, Empty, ErrorBox, Loading, Notice, PageHead, Pager, useLoad, useToast } from '../ui';

export default function Auditoria({ modo }: { modo: 'global' | 'propia' }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1), [f, setF] = useState({ modulo: '', resultado: '', q: '', desde: '', hasta: '' });
  const [cadena, setCadena] = useState<any>(null);
  const { data, error } = useLoad(() => api.get('/auditoria' + qs({ page, size: 15, ...f })), [page, f.modulo, f.resultado, f.q, f.desde, f.hasta]);
  const set = (k: string, v: string) => { setF(s => ({ ...s, [k]: v })); setPage(1); };
  const verificar = async () => { try { setCadena(await api.get('/auditoria/verificar-cadena')); } catch (e) { toast((e as Error).message, 'error'); } };
  const tecnica = user!.rol === 'Administrador';
  return (
    <div className="stack">
      <PageHead title={modo === 'propia' ? 'Mi actividad' : tecnica ? 'Auditoría técnica' : 'Auditoría'} desc={modo === 'propia' ? 'Acciones registradas con su cuenta.' : tecnica ? 'Administración, accesos y seguridad. No incluye el contenido de las evidencias.' : 'Bitácora global de solo lectura, con hash encadenado.'}>
        {modo === 'global' && (can('ver_auditoria_global') || can('ver_auditoria_tecnica')) && <button className="btn" onClick={verificar}>Verificar cadena de hashes</button>}
      </PageHead>
      {cadena && <Notice tone={cadena.integra ? '' : 'bad'}><strong>{cadena.integra ? 'Cadena íntegra.' : `Se detectaron ${cadena.problemas?.length || 0} alteraciones.`}</strong> {cadena.registros} registros verificados.{' '}
        {cadena.problemas?.map((p: any) => <div key={p.codigo + p.motivo}>{p.codigo}: {p.motivo}</div>)}<div className="small mono break">Último hash: {cadena.ultimo_hash}</div><div className="small">{cadena.nota}</div></Notice>}
      <section className="card">
        <div className="toolbar"><input className="control" placeholder="Buscar acción, referencia o usuario" value={f.q} onChange={e => set('q', e.target.value)} aria-label="Buscar" />
          <select className="control" value={f.modulo} onChange={e => set('modulo', e.target.value)} aria-label="Módulo"><option value="">Todos los módulos</option>{data?.modulos.map((m: string) => <option key={m}>{m}</option>)}</select>
          <select className="control" value={f.resultado} onChange={e => set('resultado', e.target.value)} aria-label="Resultado"><option value="">Todo resultado</option>{Object.entries(RESULTADO_AUD).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <input className="control" type="date" style={{ maxWidth: 160 }} value={f.desde} onChange={e => set('desde', e.target.value)} aria-label="Desde" /><input className="control" type="date" style={{ maxWidth: 160 }} value={f.hasta} onChange={e => set('hasta', e.target.value)} aria-label="Hasta" /></div>
        {error ? <ErrorBox e={error} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty icon="audit" title="Sin registros" /> :
          <div className="table-wrap"><table><thead><tr><th>Código</th><th>Fecha</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Referencia</th><th>Resultado</th></tr></thead>
            <tbody>{data.items.map((a: any) => <tr key={a.id_bitacora}><td><strong>{a.codigo}</strong></td><td>{dateFmt(a.fecha_hora)}<div className="audit-meta">{a.direccion_ip ?? ''}</div></td><td>{a.usuario}<div className="audit-meta">{a.rol}</div></td><td>{a.modulo}</td>
              <td>{a.accion}{a.descripcion && <div className="audit-meta">{a.descripcion}</div>}</td><td className="mono">{a.referencia}</td><td><Badge map={RESULTADO_AUD} v={a.resultado} /></td></tr>)}</tbody></table></div>}
        {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </section>
    </div>
  );
}
