const KEY = 'custodia_token';
export const getToken = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t: string | null) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } };

export class ApiError extends Error { constructor(public status: number, message: string, public codigo?: string) { super(message); } }
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f; };

async function raw(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const t = getToken();
  if (t) headers.set('Authorization', 'Bearer ' + t);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let res: Response;
  try { res = await fetch('/api' + path, { ...init, headers }); }
  catch { throw new ApiError(0, 'No se pudo conectar con el servidor.'); }
  if (!res.ok) {
    let msg = 'Error inesperado.', codigo: string | undefined;
    try { const j = await res.json(); msg = j.error ?? msg; codigo = j.codigo; } catch { /* sin cuerpo */ }
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(res.status, msg, codigo);
  }
  return res;
}
const json = async (p: string, init?: RequestInit) => (await raw(p, init)).json();
export const api = {
  get: (p: string) => json(p),
  post: (p: string, body?: unknown) => json(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: (p: string, body: unknown) => json(p, { method: 'PATCH', body: JSON.stringify(body) }),
  put: (p: string, body: unknown) => json(p, { method: 'PUT', body: JSON.stringify(body) }),
  upload: (p: string, form: FormData) => json(p, { method: 'POST', body: form }),
  async download(p: string, fallback = 'archivo', method: 'GET' | 'POST' = 'GET') {
    const res = await raw(p, { method });
    const cd = res.headers.get('Content-Disposition') ?? '';
    const m = /filename="?([^";]+)"?/.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : fallback;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return res.headers.get('X-SHA256');
  },
  async blobUrl(p: string) { return URL.createObjectURL(await (await raw(p)).blob()); },
  async text(p: string) { return (await raw(p)).text(); },
};
export const qs = (o: Record<string, unknown>) => {
  const s = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null) s.set(k, String(v)); });
  const r = s.toString();
  return r ? '?' + r : '';
};
