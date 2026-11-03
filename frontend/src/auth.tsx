import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

export interface User { id: number; codigo: string; nombre: string; rol: string; correo: string; unidad: string; permisos: string[] }
interface Ctx { user: User | null; ready: boolean; login: (u: string, p: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void>; can: (p: string) => boolean }
const C = createContext<Ctx>(null as any);
export const useAuth = () => useContext(C);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false);
  const clear = () => { setToken(null); setUser(null); };
  useEffect(() => {
    setUnauthorizedHandler(clear);
    if (!getToken()) { setReady(true); return; }
    api.get('/auth/me').then(r => setUser(r.usuario)).catch(clear).finally(() => setReady(true));
  }, []);
  const value: Ctx = {
    user, ready,
    login: async (usuario, contrasena) => { const r = await api.post('/auth/login', { usuario, contrasena }); setToken(r.token); setUser(r.usuario); },
    logout: async () => { try { await api.post('/auth/logout'); } catch { /* sesión ya inválida */ } clear(); },
    refresh: async () => { const r = await api.get('/auth/me'); setUser(r.usuario); },
    can: p => !!user?.permisos.includes(p),
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
