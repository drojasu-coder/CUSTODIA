import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ICONS } from './icons';
import { ApiError } from './api';
import { getSemaforoIntegridad } from './format';

export const Icon = ({ n }: { n: string }) => <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[n] ?? ICONS.folder} /></svg>;

export const Badge = ({ map, v }: { map: Record<string, { label: string; tone: string }>; v: string }) => {
  const x = map[v] ?? { label: v, tone: '' };
  return <span className={'badge ' + x.tone}>{x.label}</span>;
};

export const PageHead = ({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) => (
  <div className="page-head"><div><h1>{title}</h1>{desc && <p>{desc}</p>}</div><div className="row wrap">{children}</div></div>
);
export const Empty = ({ icon = 'folder', title, text }: { icon?: string; title: string; text?: string }) => (
  <div className="empty"><Icon n={icon} /><h3>{title}</h3>{text && <p>{text}</p>}</div>
);
export const Notice = ({ tone = '', children }: { tone?: '' | 'warn' | 'bad' | 'good'; children: ReactNode }) => (
  <div className={'notice ' + tone}><Icon n={tone === 'bad' ? 'alert' : tone === 'good' ? 'check' : 'info'} /><div>{children}</div></div>
);
export const Loading = () => <div className="empty"><p>Cargando…</p></div>;
export const ErrorBox = ({ e }: { e: unknown }) => <Notice tone="bad">{e instanceof Error ? e.message : 'Error inesperado.'}</Notice>;

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination no-print">
      <span>{total === 0 ? 'Sin registros' : `Mostrando ${(page - 1) * size + 1}–${Math.min(total, page * size)} de ${total}`}</span>
      <div className="row gap-sm">
        <button className="btn mini" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
        <span>Página {page} de {pages}</span>
        <button className="btn mini" disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}{hint && <small>{hint}</small>}</div>;
}

/** Hook de formulario controlado sencillo. */
export function useForm<T extends Record<string, any>>(init: T) {
  const [v, setV] = useState<T>(init);
  const bind = (k: keyof T) => ({
    value: (v[k] ?? '') as string, onChange: (e: any) => setV(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })),
  });
  return { v, setV, bind };
}

export function Modal({ title, onClose, onSubmit, submitLabel = 'Guardar', wide, danger, children, hideFoot }: {
  title: string; onClose: () => void; onSubmit?: () => Promise<void>; submitLabel?: string; wide?: boolean; danger?: boolean; children: ReactNode; hideFoot?: boolean;
}) {
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    document.body.classList.add('modal-open');
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => { document.body.classList.remove('modal-open'); window.removeEventListener('keydown', k); };
  }, [onClose]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!onSubmit || busy) return;
    setBusy(true); setErr('');
    try { await onSubmit(); } catch (x) { setErr(x instanceof ApiError || x instanceof Error ? x.message : 'Error inesperado.'); } finally { setBusy(false); }
  };
  return (
    <div className="modal-layer" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <form onSubmit={submit}>
          <div className="modal-head"><h2>{title}</h2><button type="button" className="btn ghost icon" aria-label="Cerrar" onClick={onClose}><Icon n="x" /></button></div>
          <div className="modal-body"><div className="form-error" role="alert">{err}</div>{children}</div>
          {!hideFoot && (
            <div className="modal-foot">
              <button type="button" className="btn" onClick={onClose}>Cancelar</button>
              {onSubmit && <button className={'btn ' + (danger ? 'danger' : 'primary')} disabled={busy}>{busy ? 'Procesando…' : submitLabel}</button>}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

type Toast = { id: number; msg: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems(s => [...s, { id, msg, kind }]);
    setTimeout(() => setItems(s => s.filter(t => t.id !== id)), 4500);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">
    {items.map(t => <div key={t.id} className={'toast ' + (t.kind === 'error' ? 'error' : 'success')}><Icon n={t.kind === 'error' ? 'alert' : 'check'} />{t.msg}</div>)}</div></ToastCtx.Provider>;
}

/** Ejecuta una acción de API y muestra el resultado. */
export function useAction() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, okMsg: string, after?: () => void) => {
    try { await fn(); toast(okMsg); after?.(); } catch (e) { toast(e instanceof Error ? e.message : 'Error inesperado.', 'error'); }
  };
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState<unknown>(null), [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true; setError(null);
    fn().then(d => live && setData(d)).catch(e => live && setError(e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick(t => t + 1), loading: !data && !error };
}

export function SemaforoBadge({ estado, integridad, showDesc }: { estado?: string | null; integridad?: string | null; showDesc?: boolean }) {
  const s = getSemaforoIntegridad(estado, integridad);
  return (
    <span className={'semaforo-badge ' + s.tone} title={s.desc}>
      <span className={'semaforo-dot ' + s.color} aria-hidden="true" />
      <span className="semaforo-label">{s.label}</span>
      {showDesc && <small className="semaforo-desc">{s.desc}</small>}
    </span>
  );
}

export const Hash = ({ v }: { v?: string | null }) => {
  const toast = useToast();
  if (!v) return <span className="mono break">—</span>;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(v);
        toast('Hash copiado al portapapeles');
      }
    } catch {
      // sin acceso a portapapeles
    }
  };
  return (
    <span className="hash-wrap mono break">
      <code>{v}</code>
      <button type="button" className="btn-copy" title="Copiar hash SHA-256" onClick={copy} aria-label="Copiar hash">
        <Icon n="copy" />
      </button>
    </span>
  );
};
export function Detail({ items }: { items: [string, ReactNode][] }) {
  return <div className="detail-grid">{items.map(([l, v]) => <div className="detail-item" key={l}><div className="label">{l}</div><div className="value break">{v ?? '—'}</div></div>)}</div>;
}
export function Tabs({ tabs, active, onChange }: { tabs: [string, string][]; active: string; onChange: (k: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={active === k} className={'tab' + (active === k ? ' active' : '')} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
