import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { dateFmt } from '../format';
import { Empty, ErrorBox, Icon, Loading, PageHead, useLoad, useToast } from '../ui';

const TIPOS_OP: [string, string][] = [['cadena', 'Cadena de custodia'], ['integridad', 'Verificaciones y alertas'], ['transferencias', 'Transferencias'], ['solicitudes', 'Solicitudes y análisis'], ['auditoria', 'Bitácora de auditoría']];
const TIPOS_ADM: [string, string][] = [['usuarios', 'Usuarios y roles'], ['permisos', 'Matriz de roles y permisos'], ['catalogos', 'Catálogos y ubicaciones'], ['actividad_tecnica', 'Actividad técnica']];

export default function Reportes({ admin }: { admin: boolean }) {
  const toast = useToast();
  const tipos = admin ? TIPOS_ADM : TIPOS_OP;
  const [tipo, setTipo] = useState(tipos[0][0]), [id_caso, setCaso] = useState(''), [id_evidencia, setEv] = useState(''), [desde, setDesde] = useState(''), [hasta, setHasta] = useState('');
  const [rep, setRep] = useState<any>(null), [err, setErr] = useState<unknown>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    setTipo(admin ? TIPOS_ADM[0][0] : TIPOS_OP[0][0]);
    setRep(null);
    setErr(null);
  }, [admin]);
  const casos = useLoad(() => admin ? Promise.resolve({ items: [] }) : api.get('/casos?size=100'), []);
  const evs = useLoad(() => admin ? Promise.resolve({ items: [] }) : api.get('/evidencias?size=100'), []);
  const filtros = { id_caso, id_evidencia, desde, hasta };
  const generar = async () => { setBusy(true); setErr(null); try { setRep(await api.get(`/reportes/${tipo}` + qs(filtros))); } catch (e) { setErr(e); setRep(null); } finally { setBusy(false); } };
  const csv = async () => { try { await api.download(`/reportes/${tipo}` + qs({ ...filtros, format: 'csv' }), `reporte_${tipo}.csv`); } catch (e) { toast((e as Error).message, 'error'); } };
  const usaFiltros = ['cadena', 'integridad', 'transferencias', 'solicitudes'].includes(tipo);
  const fmt = (v: any, k: string) => v == null ? '—' : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? dateFmt(v) : k === 'vence' ? String(v).slice(0, 10) : String(v);
  return (
    <div className="stack">
      <PageHead title={admin ? 'Reportes administrativos' : 'Reportes'} desc="Lectura y exportación. Cada generación queda registrada en la auditoría.">
        {rep && <><button className="btn" onClick={csv}><Icon n="download" />CSV</button><button className="btn" onClick={() => window.print()}><Icon n="printer" />Imprimir / PDF</button></>}</PageHead>
      <section className="card no-print">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select className="control" value={tipo} onChange={e => { setTipo(e.target.value); setRep(null); }} aria-label="Tipo de reporte">{tipos.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {usaFiltros && !admin && <><select className="control" value={id_caso} onChange={e => setCaso(e.target.value)} aria-label="Caso"><option value="">Todos los casos</option>{casos.data?.items.map((c: any) => <option key={c.id_caso} value={c.id_caso}>{c.codigo_caso}</option>)}</select>
            <select className="control" value={id_evidencia} onChange={e => setEv(e.target.value)} aria-label="Evidencia"><option value="">Todas las evidencias</option>{evs.data?.items.map((c: any) => <option key={c.id_evidencia} value={c.id_evidencia}>{c.codigo_unico}</option>)}</select></>}
          <input className="control" type="date" style={{ maxWidth: 160 }} value={desde} onChange={e => setDesde(e.target.value)} aria-label="Desde" /><input className="control" type="date" style={{ maxWidth: 160 }} value={hasta} onChange={e => setHasta(e.target.value)} aria-label="Hasta" />
          <button className="btn primary" onClick={generar} disabled={busy}>{busy ? 'Generando…' : 'Generar'}</button></div>
      </section>
      {err ? <ErrorBox e={err} /> : busy ? <Loading /> : !rep ? <Empty icon="report" title="Elija un reporte" text="Seleccione el tipo y los filtros, y presione Generar." /> :
        <section className="paper"><div className="small muted">Custodia Digital · Reporte generado por {rep.generado_por} · {dateFmt(rep.generado)}</div><h2 className="report-title">{rep.titulo}</h2>
          {rep.filas.length === 0 ? <Empty title="Sin datos" text="No hay registros para esos filtros." /> :
            <div className="table-wrap"><table><thead><tr>{rep.columnas.map((c: any) => <th key={c.k}>{c.label}</th>)}</tr></thead><tbody>{rep.filas.map((r: any, i: number) => <tr key={i}>{rep.columnas.map((c: any) => <td key={c.k} className={/hash|obtenido|esperado/.test(c.k) ? 'mono break' : ''}>{fmt(r[c.k], c.k)}</td>)}</tr>)}</tbody></table></div>}
          <p className="small muted spacer">{rep.filas.length} registros. Documento académico; las firmas son simuladas y no tienen valor pericial.</p></section>}
    </div>
  );
}
