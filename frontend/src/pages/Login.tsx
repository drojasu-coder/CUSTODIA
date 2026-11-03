import { useState } from 'react';
import { useAuth } from '../auth';
import { Icon } from '../ui';

export default function Login() {
  const { login } = useAuth();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await login(u, p);
    } catch (x: any) {
      if (x?.codigo === 'cuenta_bloqueada') {
        setErr(x.message || 'Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo más tarde.');
      } else if (x?.codigo === 'limite' || x?.status === 429) {
        setErr(x.message || 'Demasiados intentos desde esta red. Espere unos minutos antes de reintentar.');
      } else if (x?.codigo === 'credenciales' || x?.status === 401) {
        setErr('Usuario o contraseña incorrectos.');
      } else {
        setErr(x instanceof Error ? x.message : 'Error al iniciar sesión.');
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="login-art">
        <div className="brand"><div className="logo"><Icon n="shield" /></div><div className="brand-text"><div className="brand-title">Custodia Digital</div><div className="brand-sub">CADENA DE CUSTODIA</div></div></div>
        <div><h1>Trazabilidad que se puede verificar.</h1><p>Registro, resguardo, transferencia y análisis de evidencia digital con huella SHA-256 y bitácora inalterable.</p>
          <div className="trust"><div className="row"><Icon n="lock" /> Hash inicial inmutable</div><div className="row"><Icon n="audit" /> Auditoría encadenada</div><div className="row"><Icon n="key" /> Acceso por rol y por objeto</div></div></div>
        <span className="small" style={{ color: '#809ab9' }}>Acceso seguro · Sistema institucional de cadena de custodia</span>
      </div>
      <div className="login-form">
        <h2>Iniciar sesión</h2><p className="sub">Ingrese con su correo institucional o nombre de usuario.</p>
        <form onSubmit={submit}>
          {err && <div className="form-error" role="alert">{err}</div>}
          <div className="field"><label htmlFor="u">Correo o usuario</label><input id="u" autoComplete="username" placeholder="ej. usuario@institucion.gob" value={u} onChange={e => setU(e.target.value)} required /></div>
          <div className="field"><label htmlFor="p">Contraseña</label><input id="p" type="password" autoComplete="current-password" placeholder="••••••••" value={p} onChange={e => setP(e.target.value)} required /></div>
          <button className="btn primary full" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
        <p className="login-help">Ambiente académico y pericial. Las operaciones quedan registradas en la bitácora de auditoría inalterable.</p>
      </div>
    </div>
  );
}

