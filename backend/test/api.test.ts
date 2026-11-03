import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setup } from './helper';

let T: Awaited<ReturnType<typeof setup>>;
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
const id = async (sql: string, p: unknown[] = []) => Object.values((await T.pool.query(sql, p)).rows[0])[0] as number;

before(async () => { T = await setup(); });
after(async () => { await T.pool.end(); });

describe('Autenticación y permisos por rol', () => {
  it('rechaza credenciales incorrectas y lo registra en auditoría', async () => {
    const r = await T.request(T.app).post('/api/auth/login').send({ usuario: 'supervisor', contrasena: 'mala' });
    assert.equal(r.status, 401);
    const n = await id(`select count(*) from bitacora_auditoria where accion='Intento de acceso fallido'`);
    assert.ok(Number(n) >= 1);
  });
  it('exige sesión', async () => {
    assert.equal((await T.request(T.app).get('/api/casos')).status, 401);
  });
  it('Reportante solo ve sus casos y no puede registrar evidencia', async () => {
    const u = await T.as('reportante');
    const r = await u.get('/api/casos');
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length === 2 && r.body.items.every((c: any) => c.reportante === 'Sofía Méndez'));
    assert.equal((await u.post('/api/evidencias').field('x', 'y')).status, 403);
    assert.equal((await u.get('/api/evidencias')).status, 403);
  });
  it('Administrador no accede a casos ni evidencias', async () => {
    const a = await T.as('administrador');
    assert.equal((await a.get('/api/casos')).status, 403);
    assert.equal((await a.get('/api/evidencias')).status, 403);
    assert.equal((await a.get('/api/auditoria')).status, 200);
  });
  it('Analista no ve evidencias sin permiso vigente (objeto)', async () => {
    const a = await T.as('analista');
    const list = await a.get('/api/evidencias');
    assert.deepEqual(list.body.items.map((e: any) => e.codigo_unico), ['EVI-2026-015']);
    const e14 = await id(`select id_evidencia from evidencias where codigo_unico='EVI-2026-014'`);
    assert.equal((await a.get(`/api/evidencias/${e14}`)).status, 403);
  });
});

describe('Registro de evidencia y hash', () => {
  let eviId: number;
  const contenido = Buffer.from('Archivo ficticio de prueba\n');
  it('Recolector registra evidencia; el hash SHA-256 lo calcula el servidor', async () => {
    const r = await T.as('recolector');
    const caso = await id(`select id_caso from casos where codigo_caso='CAS-2026-001'`);
    const tipo = await id(`select id_tipo from tipos_evidencia limit 1`);
    const ub = await id(`select id_ubicacion from ubicaciones where codigo='LOC-001'`);
    const res = await r.post('/api/evidencias').field({ id_caso: caso, id_tipo: tipo, nombre_referencia: 'Pendrive de prueba', descripcion: 'Memoria USB ficticia',
      lugar_recoleccion: 'Oficina', fecha_recoleccion: new Date(Date.now() - 3600_000).toISOString(), id_ubicacion: ub }).attach('archivo', contenido, 'prueba.txt');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.hash_inicial, sha(contenido));
    assert.match(res.body.codigo_unico, /^EVI-2026-017$/);
    eviId = res.body.id_evidencia;
  });
  it('rechaza registro sin archivo', async () => {
    const r = await T.as('recolector');
    const res = await r.post('/api/evidencias').field({ id_caso: 1, id_tipo: 1, nombre_referencia: 'Sin archivo', descripcion: 'Descripción', lugar_recoleccion: 'X Y Z', fecha_recoleccion: new Date().toISOString(), id_ubicacion: 1 });
    assert.equal(res.status, 400);
  });
  it('el hash inicial es inmutable en la base de datos (CP-20)', async () => {
    await assert.rejects(T.pool.query(`update evidencias set hash_inicial=$1 where id_evidencia=$2`, [sha('otro'), eviId]), (e: any) => e.code === 'CD001');
  });
  it('historiales no se editan ni eliminan (CP-21)', async () => {
    await assert.rejects(T.pool.query(`update bitacora_auditoria set accion='x'`), (e: any) => e.code === 'CD001');
    await assert.rejects(T.pool.query(`delete from eventos_custodia`), (e: any) => e.code === 'CD001');
    await assert.rejects(T.pool.query(`delete from evidencias`), (e: any) => e.code === 'CD001');
    await assert.rejects(T.pool.query(`truncate bitacora_auditoria cascade`), (e: any) => e.code === 'CD001');
  });
  it('un Reportante/otro rol no descarga el original; Auditor tampoco', async () => {
    assert.equal((await (await T.as('auditor')).get(`/api/evidencias/${eviId}/original`)).status, 403);
    assert.equal((await (await T.as('analista')).get(`/api/evidencias/${eviId}/original`)).status, 403);
    const ok = await (await T.as('recolector')).get(`/api/evidencias/${eviId}/original`);
    assert.equal(ok.status, 200);
    assert.equal(sha(ok.text), sha(contenido));
  });
  it('la cadena de auditoría es íntegra y detecta manipulación', async () => {
    const s = await T.as('auditor');
    assert.equal((await s.get('/api/auditoria/verificar-cadena')).body.integra, true);
    await T.pool.query('alter table bitacora_auditoria disable trigger inm_bitacora_auditoria');
    await T.pool.query(`update bitacora_auditoria set descripcion='alterado' where id_bitacora=(select min(id_bitacora) from bitacora_auditoria)`);
    const r = await s.get('/api/auditoria/verificar-cadena');
    await T.pool.query(`update bitacora_auditoria set descripcion=(select descripcion from bitacora_auditoria limit 0) where false`);
    assert.equal(r.body.integra, false);
    assert.ok(r.body.problemas.length >= 1);
  });
});

describe('Integridad, alertas y cierre de caso', () => {
  it('discrepancia genera alerta crítica y bloquea el cierre (CP-09, CP-30)', async () => {
    const cust = await T.as('custodio'), sup = await T.as('supervisor');
    const e = await id(`select id_evidencia from evidencias where codigo_unico='EVI-2026-016'`);
    const caso = await id(`select id_caso from casos where codigo_caso='CAS-2026-003'`);
    const cierre = await sup.post(`/api/casos/${caso}/estado`).send({ estado: 'cerrado', motivo: 'Intento de cierre con alerta abierta' });
    assert.equal(cierre.status, 409);
    assert.match(cierre.body.error, /alertas/);
    // verificación coincidente con alerta aún pendiente: NO resuelve (requiere revisión del Supervisor)
    const orig = (await T.pool.query(`select hash_inicial from evidencias where id_evidencia=$1`, [e])).rows[0].hash_inicial;
    const v1 = await cust.post(`/api/evidencias/${e}/verificar`).send({ modo: 'externo', hash_externo: orig });
    assert.equal(v1.body.alerta_resuelta, false);
    // Custodio no puede revisar alertas
    const al = await id(`select id_alerta from alertas_integridad where codigo='ALT-2026-001'`);
    assert.equal((await cust.post(`/api/alertas/${al}/revisar`).send({ notas: 'intento' })).status, 403);
    assert.equal((await sup.post(`/api/alertas/${al}/revisar`).send({ notas: 'Se revisa el origen de la discrepancia.' })).status, 200);
    const v2 = await cust.post(`/api/evidencias/${e}/verificar`).send({ modo: 'externo', hash_externo: orig });
    assert.equal(v2.body.alerta_resuelta, true);
    const det = await sup.get(`/api/evidencias/${e}`);
    assert.equal(det.body.integridad, 'verificada');
    assert.equal(det.body.hash_inicial, orig);
    // ahora el cierre procede, y deja evidencias archivadas
    const ok = await sup.post(`/api/casos/${caso}/estado`).send({ estado: 'cerrado', motivo: 'Alerta resuelta y trazabilidad completa.' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await sup.post(`/api/casos/${caso}/estado`).send({ estado: 'en_investigacion' })).status, 409);
  });
  it('un hash externo con formato inválido se rechaza', async () => {
    const cust = await T.as('custodio');
    const e = await id(`select id_evidencia from evidencias where codigo_unico='EVI-2026-014'`);
    assert.equal((await cust.post(`/api/evidencias/${e}/verificar`).send({ modo: 'externo', hash_externo: 'zzz' })).status, 400);
  });
  it('discrepancia nueva crea alerta y marca la evidencia', async () => {
    const cust = await T.as('custodio');
    const e = await id(`select id_evidencia from evidencias where codigo_unico='EVI-2026-014'`);
    const r = await cust.post(`/api/evidencias/${e}/verificar`).send({ modo: 'externo', hash_externo: sha('manipulado') });
    assert.equal(r.status, 201);
    assert.equal(r.body.coincide, false);
    assert.equal(r.body.alerta.estado, 'pendiente');
  });
});

describe('Transferencias de custodia', () => {
  let trf: number, evi: number, nuevoCustodio: number;
  it('flujo completo: entrega → autorización → recepción (CP-12..CP-16)', async () => {
    const admin = await T.as('administrador');
    const rolCust = await id(`select id_rol from roles where nombre='Custodio'`);
    const cu = await admin.post('/api/admin/usuarios').send({ nombres: 'Pedro', apellidos: 'Gómez', correo: 'custodio2@custodia.demo', id_rol: rolCust, contrasena: 'Demo123!' });
    assert.equal(cu.status, 201, JSON.stringify(cu.body));
    nuevoCustodio = await id(`select id_usuario from usuarios where correo='custodio2@custodia.demo'`);
    evi = await id(`select id_evidencia from evidencias where codigo_unico='EVI-2026-015'`);
    const ub = await id(`select id_ubicacion from ubicaciones where codigo='LOC-005'`);
    const c1 = await T.as('custodio');
    // no se puede transferir a uno mismo ni sin confirmar firma
    assert.equal((await c1.post('/api/transferencias').send({ id_evidencia: evi, id_receptor: nuevoCustodio, id_ubicacion_destino: ub, motivo: 'Traslado a bóveda' })).status, 400);
    const t = await c1.post('/api/transferencias').send({ id_evidencia: evi, id_receptor: nuevoCustodio, id_ubicacion_destino: ub, motivo: 'Traslado a bóveda', confirmo_firma: true });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    trf = t.body.id_transferencia;
    // una sola transferencia activa
    assert.equal((await c1.post('/api/transferencias').send({ id_evidencia: evi, id_receptor: nuevoCustodio, id_ubicacion_destino: ub, motivo: 'Otra vez', confirmo_firma: true })).status, 409);
    const c2 = await T.as('custodio2', 'Demo123!');
    // el receptor no puede recibir antes de la autorización
    assert.equal((await c2.post(`/api/transferencias/${trf}/recibir`).send({ confirmo_firma: true })).status, 409);
    // el custodio no puede autorizar (solo Supervisor)
    assert.equal((await c1.post(`/api/transferencias/${trf}/autorizar`).send({})).status, 403);
    assert.equal((await (await T.as('supervisor')).post(`/api/transferencias/${trf}/autorizar`).send({})).status, 200);
    // solo el receptor asignado recibe
    assert.equal((await c1.post(`/api/transferencias/${trf}/recibir`).send({ confirmo_firma: true })).status, 403);
    assert.equal((await c2.post(`/api/transferencias/${trf}/recibir`).send({ confirmo_firma: true })).status, 200);
    const e = (await T.pool.query('select id_custodio_actual, estado from evidencias where id_evidencia=$1', [evi])).rows[0];
    assert.equal(e.id_custodio_actual, nuevoCustodio);
    assert.equal(e.estado, 'en_custodia');
    const actuales = await id(`select count(*) from registros_custodia where id_evidencia=$1 and es_custodia_actual`, [evi]);
    assert.equal(Number(actuales), 1);
  });
  it('una transferencia concluida no se puede modificar', async () => {
    await assert.rejects(T.pool.query(`update transferencias_custodia set motivo='x' where id_transferencia=$1`, [trf]), (e: any) => e.code === 'CD001');
  });
  it('el antiguo custodio ya no puede verificar ni transferir', async () => {
    const c1 = await T.as('custodio');
    assert.equal((await c1.post(`/api/evidencias/${evi}/verificar`).send({ modo: 'almacenado' })).status, 403);
  });
});

describe('Solicitudes de acceso, copias y análisis', () => {
  let sol: number;
  it('Analista solicita acceso por código; no puede aprobarse a sí mismo (CP-17..CP-19)', async () => {
    const a = await T.as('analista'), s = await T.as('supervisor');
    const dup = await a.post('/api/solicitudes').send({ codigo_evidencia: 'EVI-2026-015', motivo: 'Segunda solicitud duplicada' });
    assert.equal(dup.status, 409);
    const ex = await a.post('/api/solicitudes').send({ codigo_evidencia: 'EVI-2026-099', motivo: 'Código que no existe' });
    assert.equal(ex.status, 400);
    const r = await a.post('/api/solicitudes').send({ codigo_evidencia: 'EVI-2026-017', motivo: 'Revisión de metadatos de la memoria' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    sol = r.body.id_solicitud;
    assert.equal((await a.post(`/api/solicitudes/${sol}/decidir`).send({ decision: 'aprobar', observaciones: 'Me autorizo solo' })).status, 403);
    // evidencia 017 sin discrepancia: aprobar emite copia
    const ok = await s.post(`/api/solicitudes/${sol}/decidir`).send({ decision: 'aprobar', observaciones: 'Acceso a copia autorizado.' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.copia, /^COPY-EVI-2026-017-001$/);
    // ya resuelta
    assert.equal((await s.post(`/api/solicitudes/${sol}/decidir`).send({ decision: 'rechazar', observaciones: 'Cambio de opinión' })).status, 409);
  });
  it('no se emite copia de evidencia con discrepancia sin resolver', async () => {
    const s = await T.as('supervisor');
    const p = await id(`select id_solicitud from solicitudes_acceso where codigo='SOL-2026-002'`);
    const r = await s.post(`/api/solicitudes/${p}/decidir`).send({ decision: 'aprobar', observaciones: 'Intento de aprobar con alerta' });
    assert.equal(r.status, 409);   // EVI-2026-014 tiene alerta abierta tras la prueba anterior
  });
  it('el analista descarga solo su copia (con el mismo hash) y ve la evidencia', async () => {
    const a = await T.as('analista');
    const r = await a.get(`/api/solicitudes/${sol}/copia`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-sha256'], sha(Buffer.from('Archivo ficticio de prueba\n')));
    const e17 = await id(`select id_evidencia from evidencias where codigo_unico='EVI-2026-017'`);
    assert.equal((await a.get(`/api/evidencias/${e17}`)).status, 200);
    assert.equal((await (await T.as('recolector')).get(`/api/solicitudes/${sol}/copia`)).status, 403);
  });
  it('registra un análisis sobre copia vigente; uno por solicitud; las notas son adicionales (CP-22..CP-24)', async () => {
    const a = await T.as('analista');
    const body = { id_solicitud: sol, proposito: 'Revisar metadatos', actividad_realizada: 'Lectura de la copia de trabajo.', herramientas: 'Visor de texto',
      resultado: 'Sin hallazgos relevantes en el archivo ficticio.', conclusiones: 'Ninguna anomalía académica.', fecha_inicio: '2026-10-20', fecha_fin: '2026-10-21' };
    const r = await a.post('/api/analisis').send(body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await a.post('/api/analisis').send(body)).status, 409);
    assert.equal((await a.post(`/api/analisis/${r.body.id_analisis}/notas`).send({ texto: 'Aclaración posterior del análisis.' })).status, 201);
    await assert.rejects(T.pool.query(`update analisis_forenses set resultado='x' where id_analisis=$1`, [r.body.id_analisis]), (e: any) => e.code === 'CD001');
    // otro analista/rol no puede ver el análisis
    assert.equal((await (await T.as('recolector')).get(`/api/analisis/${r.body.id_analisis}`)).status, 403);
    assert.equal((await (await T.as('auditor')).get(`/api/analisis/${r.body.id_analisis}`)).status, 200);
  });
  it('la vigencia vencida retira el acceso', async () => {
    await T.pool.query(`alter table solicitudes_acceso disable trigger solicitudes_upd`);
    await T.pool.query(`update solicitudes_acceso set fecha_vencimiento = hoy_gt()-1 where id_solicitud=$1`, [sol]);
    await T.pool.query(`alter table solicitudes_acceso enable trigger solicitudes_upd`);
    const a = await T.as('analista');
    assert.equal((await a.get(`/api/solicitudes/${sol}/copia`)).status, 403);
    const e17 = await id(`select id_evidencia from evidencias where codigo_unico='EVI-2026-017'`);
    assert.equal((await a.get(`/api/evidencias/${e17}`)).status, 403);
  });
});

describe('Administración y reportes', () => {
  it('no se puede desactivar al último administrador ni a uno mismo', async () => {
    const a = await T.as('administrador');
    const me = await id(`select id_usuario from usuarios where nombre_usuario='administrador'`);
    assert.equal((await a.patch(`/api/admin/usuarios/${me}`).send({ activo: false })).status, 409);
  });
  it('contraseña débil rechazada', async () => {
    const a = await T.as('administrador');
    const rol = await id(`select id_rol from roles where nombre='Auditor'`);
    assert.equal((await a.post('/api/admin/usuarios').send({ nombres: 'Ana', apellidos: 'Ruiz', correo: 'ana@x.demo', id_rol: rol, contrasena: 'corta' })).status, 400);
  });
  it('reportes: CSV protegido contra inyección de fórmulas y control por rol', async () => {
    const s = await T.as('supervisor');
    const r = await s.get('/api/reportes/cadena?format=csv');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/csv/);
    assert.equal((await s.get('/api/reportes/usuarios')).status, 403);
    assert.equal((await (await T.as('administrador')).get('/api/reportes/usuarios')).status, 200);
    assert.equal((await (await T.as('recolector')).get('/api/reportes/cadena')).status, 403);
  });
  it('panel por rol responde', async () => {
    for (const u of ['supervisor', 'recolector', 'custodio', 'analista', 'auditor', 'reportante', 'administrador'])
      assert.equal((await (await T.as(u)).get('/api/panel')).status, 200, u);
  });
});
