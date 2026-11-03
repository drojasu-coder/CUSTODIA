const TZ = 'America/Guatemala';
export const dateFmt = (t?: string | null) => t ? new Intl.DateTimeFormat('es-GT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t)) : '—';
export const dateOnly = (t?: string | null) => t ? new Intl.DateTimeFormat('es-GT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(t.length === 10 ? t + 'T12:00:00-06:00' : t)) : '—';
export const sizeFmt = (n: number) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
export const initials = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
export const hoyGT = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

type Tone = 'good' | 'warn' | 'bad' | 'info' | '';
const m = (label: string, tone: Tone = '') => ({ label, tone });
export const ESTADO_CASO: Record<string, { label: string; tone: Tone }> = {
  abierto: m('Abierto', 'info'), en_investigacion: m('En investigación', 'info'), suspendido: m('Suspendido', 'warn'), cerrado: m('Cerrado', 'good'), archivado: m('Archivado') };
export const ESTADO_EVID: Record<string, { label: string; tone: Tone }> = {
  registrada: m('Registrada'), recolectada: m('Recolectada'), en_custodia: m('En custodia', 'info'), transferida: m('En transferencia', 'warn'),
  en_analisis: m('En análisis', 'info'), verificada: m('Verificada', 'good'), con_alerta: m('Con alerta', 'bad'), archivada: m('Archivada') };
export const INTEGRIDAD: Record<string, { label: string; tone: Tone }> = {
  sin_verificar: m('Sin verificar'), verificada: m('Verificada', 'good'), no_coincide: m('No coincide', 'bad'), en_revision: m('En revisión', 'warn') };
export const ESTADO_TRF: Record<string, { label: string; tone: Tone }> = {
  pendiente: m('Pendiente de autorización', 'warn'), autorizada: m('Pendiente de recepción', 'warn'), recibida: m('Completada', 'good'), rechazada: m('Rechazada', 'bad'), cancelada: m('Cancelada') };
export const ESTADO_SOL: Record<string, { label: string; tone: Tone }> = {
  pendiente: m('Pendiente', 'warn'), aprobada: m('Aprobada', 'good'), rechazada: m('Rechazada', 'bad'), vencida: m('Vencida'), cerrada: m('Cerrada') };
export const ESTADO_ALERTA: Record<string, { label: string; tone: Tone }> = {
  pendiente: m('Pendiente', 'bad'), en_revision: m('En revisión', 'warn'), resuelta: m('Resuelta', 'good'), descartada: m('Descartada') };
export const RESULTADO_AUD: Record<string, { label: string; tone: Tone }> = {
  exitoso: m('Éxito', 'good'), rechazado: m('Rechazado', 'warn'), error: m('Error', 'bad'), critico: m('Crítico', 'bad') };
export const MODO_VER: Record<string, string> = { almacenado: 'Archivo almacenado', externo: 'Hash externo', simulacion: 'Simulación de discrepancia', inicial: 'Inicial' };

export const NAV: [string, string, string, string][] = [
  // clave, etiqueta, icono, ruta
  ['admin-dashboard', 'Panel administrativo', 'home', '/admin'], ['dashboard', 'Panel principal', 'home', '/'],
  ['admin-users', 'Usuarios y accesos', 'users', '/admin/usuarios'], ['admin-roles', 'Roles y permisos', 'lock', '/admin/roles'],
  ['admin-catalogs', 'Catálogos', 'folder', '/admin/catalogos'], ['cases', 'Casos e incidentes', 'folder', '/casos'],
  ['evidences', 'Evidencias', 'drive', '/evidencias'], ['custody', 'Custodia y transferencias', 'transfer', '/custodia'],
  ['requests', 'Solicitudes de acceso', 'key', '/solicitudes'], ['forensic', 'Análisis forense', 'flask', '/analisis'],
  ['alerts', 'Integridad y alertas', 'shield', '/alertas'], ['locations', 'Ubicaciones', 'pin', '/ubicaciones'],
  ['audit', 'Auditoría', 'audit', '/auditoria'], ['activity', 'Mi actividad', 'clock', '/actividad'],
  ['reports', 'Reportes', 'report', '/reportes'], ['admin-reports', 'Reportes administrativos', 'report', '/admin/reportes'],
  ['admin-settings', 'Configuración y respaldo', 'refresh', '/admin/configuracion'],
];
export const MODULOS: Record<string, string[]> = {
  Reportante: ['dashboard', 'cases', 'activity'],
  Recolector: ['dashboard', 'cases', 'evidences', 'custody', 'alerts', 'activity'],
  Custodio: ['dashboard', 'evidences', 'custody', 'alerts', 'locations', 'activity'],
  'Analista forense': ['dashboard', 'cases', 'evidences', 'requests', 'forensic', 'alerts', 'activity'],
  Supervisor: ['dashboard', 'cases', 'evidences', 'custody', 'requests', 'forensic', 'alerts', 'locations', 'audit', 'reports'],
  Auditor: ['dashboard', 'cases', 'evidences', 'custody', 'requests', 'forensic', 'alerts', 'locations', 'audit', 'reports'],
  Administrador: ['admin-dashboard', 'admin-users', 'admin-roles', 'admin-catalogs', 'locations', 'audit', 'admin-reports', 'admin-settings'],
};
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  Reportante: 'Registra incidentes y sigue el estado de sus propios reportes.',
  Recolector: 'Registra evidencia en casos permitidos y entrega lo que está bajo su responsabilidad.',
  Custodio: 'Recibe, resguarda y entrega evidencia con confirmación personal.',
  'Analista forense': 'Trabaja sobre copias asignadas mediante un permiso aprobado y vigente.',
  Supervisor: 'Autoriza accesos y transferencias, revisa integridad y decide el cierre de casos.',
  Auditor: 'Consulta la operación y sus registros en modo de solo lectura.',
  Administrador: 'Gestiona cuentas, roles, catálogos, configuración y auditoría técnica.',
};
export type SemaforoColor = 'verde' | 'amarillo' | 'rojo';
export interface SemaforoInfo { color: SemaforoColor; label: string; tone: 'good' | 'warn' | 'bad'; desc: string }
export function getSemaforoIntegridad(estado?: string | null, integridad?: string | null): SemaforoInfo {
  const est = estado ?? '', integ = integridad ?? '';
  if (est === 'con_alerta' || integ === 'no_coincide' || integ === 'en_revision') {
    return { color: 'rojo', label: integ === 'en_revision' ? 'En revisión' : 'Anomalía', tone: 'bad', desc: 'Discrepancia en la huella SHA-256 o alerta de integridad en curso.' };
  }
  if (est === 'transferida' || est === 'en_analisis') {
    return { color: 'amarillo', label: est === 'transferida' ? 'En transferencia' : 'En análisis', tone: 'warn', desc: 'Evidencia en tránsito de transferencia o en análisis forense.' };
  }
  if (est === 'en_custodia' || est === 'verificada' || integ === 'verificada') {
    return { color: 'verde', label: 'Íntegra en custodia', tone: 'good', desc: 'Evidencia bajo resguardo con huella digital SHA-256 intacta.' };
  }
  if (integ === 'sin_verificar' || est === 'registrada' || est === 'recolectada') {
    return { color: 'amarillo', label: 'Sin verificar', tone: 'warn', desc: 'Registrada; pendiente de primera verificación periódica de integridad.' };
  }
  if (est === 'archivada') {
    return { color: 'verde', label: 'Archivada (íntegra)', tone: 'good', desc: 'Caso concluido con archivo íntegro y trazabilidad histórica.' };
  }
  return { color: 'verde', label: 'Íntegra', tone: 'good', desc: 'Estado íntegro verificado.' };
}
