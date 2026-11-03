import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { initials, MODULOS, NAV } from './format';
import { Icon, Loading } from './ui';
import Login from './pages/Login';
import Dashboard, { AdminDashboard } from './pages/Dashboard';
import { CasoDetalle, Casos } from './pages/Casos';
import { EvidenciaDetalle, Evidencias } from './pages/Evidencias';
import Custodia from './pages/Custodia';
import Solicitudes from './pages/Solicitudes';
import Analisis from './pages/Analisis';
import Alertas from './pages/Alertas';
import Ubicaciones from './pages/Ubicaciones';
import Auditoria from './pages/Auditoria';
import Reportes from './pages/Reportes';
import { AdminCatalogos, AdminConfig, AdminRoles, AdminUsuarios } from './pages/Admin';
import Perfil from './pages/Perfil';

const pref = (v?: string) => { try { if (v !== undefined) localStorage.setItem('custodia_sidebar', v); return localStorage.getItem('custodia_sidebar') === 'true'; } catch { return false; } };

export default function App() {
  const { user, ready, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(pref());
  const [mobile, setMobile] = useState(false);
  const loc = useLocation(), nav = useNavigate();
  useEffect(() => setMobile(false), [loc.pathname]);
  if (!ready) return <Loading />;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;

  const mods = MODULOS[user.rol] ?? [];
  const items = NAV.filter(n => mods.includes(n[0]));
  const current = [...items].sort((a, b) => b[3].length - a[3].length).find(n => n[3] === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n[3]));
  const guard = (key: string, el: JSX.Element) => mods.includes(key) ? el : <Navigate to={user.rol === 'Administrador' ? '/admin' : '/'} replace />;
  const home = user.rol === 'Administrador';

  return (
    <div className={(collapsed ? 'collapsed ' : '') + (mobile ? 'mobile-open' : '')}>
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="brand"><div className="logo"><Icon n="shield" /></div><div className="brand-text"><div className="brand-title">Custodia Digital</div><div className="brand-sub">CADENA DE CUSTODIA</div></div></div>
        <nav className="side-nav"><div className="nav-section">MÓDULOS</div>
          {items.map(([k, label, ic, to]) => (
            <NavLink key={k} to={to} end={to === '/' || to === '/admin'} aria-label={label} className={({ isActive }) => 'nav-btn' + (isActive || current?.[0] === k ? ' active' : '')} style={{ textDecoration: 'none' }}>
              <Icon n={ic} /><span className="nav-label">{label}</span></NavLink>))}
        </nav>
        <div className="side-foot">
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="avatar" style={{ border: 0 }} aria-label="Mi perfil" onClick={() => nav('/perfil')}>{initials(user.nombre)}</button>
            <div className="user-text" style={{ minWidth: 0 }}><div className="user-name">{user.nombre}</div><div className="user-role">{user.rol}</div></div>
          </div>
          <button className="btn full" data-action="logout" onClick={() => logout().then(() => nav('/'))}><Icon n="logout" /><span className="btn-label">Cerrar sesión</span></button>
        </div>
      </aside>
      <div className="backdrop" onClick={() => setMobile(false)} />
      <div className="main">
        <header className="topbar">
          <div className="row">
            <button className="btn icon mobile-only" aria-label="Abrir menú" onClick={() => setMobile(true)}><Icon n="menu" /></button>
            <button className="btn icon desktop-only" aria-label="Contraer menú" onClick={() => { setCollapsed(!collapsed); pref(String(!collapsed)); }}><Icon n="menu" /></button>
            <div><div className="crumb">{user.rol}</div><div className="top-title">{current?.[1] ?? (loc.pathname === '/perfil' ? 'Mi perfil' : 'Custodia Digital')}</div></div>
          </div>
          <div className="top-actions"><span className="top-date">{new Intl.DateTimeFormat('es-GT', { dateStyle: 'full', timeZone: 'America/Guatemala' }).format(new Date())}</span>
            <span className="badge info">Datos académicos ficticios</span></div>
        </header>
        <main id="main-content" className="content">
          <Routes>
            <Route path="/" element={home ? <Navigate to="/admin" replace /> : <Dashboard />} />
            <Route path="/casos" element={guard('cases', <Casos />)} />
            <Route path="/casos/:id" element={guard('cases', <CasoDetalle />)} />
            <Route path="/evidencias" element={guard('evidences', <Evidencias />)} />
            <Route path="/evidencias/:id" element={guard('evidences', <EvidenciaDetalle />)} />
            <Route path="/custodia" element={guard('custody', <Custodia />)} />
            <Route path="/solicitudes" element={guard('requests', <Solicitudes />)} />
            <Route path="/analisis" element={guard('forensic', <Analisis />)} />
            <Route path="/alertas" element={guard('alerts', <Alertas />)} />
            <Route path="/ubicaciones" element={guard('locations', <Ubicaciones />)} />
            <Route path="/auditoria" element={guard('audit', <Auditoria modo="global" />)} />
            <Route path="/actividad" element={guard('activity', <Auditoria modo="propia" />)} />
            <Route path="/reportes" element={guard('reports', <Reportes admin={false} />)} />
            <Route path="/admin" element={guard('admin-dashboard', <AdminDashboard />)} />
            <Route path="/admin/usuarios" element={guard('admin-users', <AdminUsuarios />)} />
            <Route path="/admin/roles" element={guard('admin-roles', <AdminRoles />)} />
            <Route path="/admin/catalogos" element={guard('admin-catalogs', <AdminCatalogos />)} />
            <Route path="/admin/reportes" element={guard('admin-reports', <Reportes admin />)} />
            <Route path="/admin/configuracion" element={guard('admin-settings', <AdminConfig />)} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="footer"><span>Custodia Digital · Prototipo académico UMG · Análisis de Sistemas 2</span><span>Firmas simuladas · sin valor legal ni pericial</span></footer>
      </div>
    </div>
  );
}
