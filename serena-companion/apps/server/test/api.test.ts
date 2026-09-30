import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { addUser, device, login, makeCtx } from './helpers.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

function checkin(over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    deviceName: 'Tel',
    deviceKind: 'mobile',
    rosterDay: 9,
    onShift: true,
    animo: 3,
    sueno: 1,
    escaneo: { metricas: { pulso: 78, hrv: 42, respiracion: 15, estres: 3.1 }, calidad: 0.9, duracionS: 45 },
    reaccion: { toques: 10, mediaMs: 312, anticipados: 0 },
    voz: null,
    nivel: 'bajo', // el servidor lo recalcula
    nota: null,
    ...over,
  };
}

describe('indicadores oculares (modo registro)', () => {
  const ocular = { perclos: 0.04, parpadeosPorMin: 16.5, parpadeoMedioMs: 180, cierresLargos: 1, cierreMaxMs: 620, cabeceos: 0, cobertura: 0.95, duracionS: 60, cuadrosPorS: 29.5, valido: true };

  async function sesion() {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '30111222', 'p');
    const push = (c: Record<string, unknown> & { id: string; updatedAt: string }) =>
      request(app)
        .post('/api/sync/push')
        .set(bearer(s.token))
        .send({ mutations: [{ mutationId: randomUUID(), entity: 'checkin', id: c.id, op: 'upsert', data: c, updatedAt: c.updatedAt, deviceId: s.deviceId }] });
    return { app, s, push };
  }

  it('se guardan con el check-in y no cambian el nivel', async () => {
    const { app, s, push } = await sesion();
    // El mismo check-in con y sin somnolencia extrema en los ojos: el nivel tiene que ser el mismo (modo registro).
    const sin = checkin();
    const con = { ...checkin(), ocular: { ...ocular, perclos: 0.6, cierresLargos: 9 } };
    expect((await push(sin)).body.resultados[0].status).toBe('aplicada');
    expect((await push(con)).body.resultados[0].status).toBe('aplicada');
    const pull = await request(app).get('/api/sync/pull?cursor=0').set(bearer(s.token));
    const dato = (id: string) => pull.body.cambios.find((x: { id: string }) => x.id === id).data;
    expect(dato(con.id).ocular).toEqual(con.ocular);
    expect(dato(con.id).nivel).toBe(dato(sin.id).nivel);
  });

  it('las versiones anteriores de la app, sin el campo, siguen funcionando', async () => {
    const { push } = await sesion();
    expect((await push(checkin())).body.resultados[0].status).toBe('aplicada');
  });

  it('valores fuera de rango se rechazan', async () => {
    const { push } = await sesion();
    expect((await push(checkin({ ocular: { ...ocular, perclos: 1.5 } }))).body.resultados[0]).toMatchObject({ status: 'rechazada', motivo: 'formato' });
  });
});

describe('ingreso seguro', () => {
  it('pide segundo factor, rechaza código incorrecto y abre sesión con el correcto', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '30.456.789', legajo: '1', password: 'clave-segura' });

    const bad = await request(app).post('/api/auth/login').send({ identificador: '30456789', password: 'x', device: device() });
    expect(bad.status).toBe(401);

    const r1 = await request(app).post('/api/auth/login').send({ identificador: '30.456.789', password: 'clave-segura', device: device() });
    expect(r1.body.paso).toBe('segundo_factor');
    expect(r1.body.telefonoTermina).toBe('47');
    expect(r1.body.codigoDesarrollo).toBeUndefined();

    const wrong = messenger.last === '000000' ? '111111' : '000000';
    const r2 = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: wrong, device: device() });
    expect(r2.status).toBe(401);
    expect(r2.body.mensaje).toBe('El código no coincide. Revisá los 6 dígitos o pedí uno nuevo.');

    const r3 = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: messenger.last, device: device() });
    expect(r3.status).toBe(200);
    const me = await request(app).get('/api/me').set(bearer(r3.body.token));
    expect(me.body.perfil.nombreCorto).toBe('Persona');

    // El mismo código no sirve dos veces.
    const replay = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: messenger.last, device: device() });
    expect(replay.status).toBe(401);
  });

  it('bloquea el desafío después de 5 intentos fallidos', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '1234567', legajo: '1', password: 'p' });
    const r1 = await request(app).post('/api/auth/login').send({ identificador: '1234567', password: 'p', device: device() });
    const wrong = messenger.last === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: wrong, device: device() });
    const ok = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: messenger.last, device: device() });
    expect(ok.status).toBe(401);
    expect(ok.body.error).toBe('codigo_vencido');
  });

  it('recordar este dispositivo omite el segundo factor en escritorio', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '7654321', legajo: '1', password: 'p' });
    const r1 = await request(app).post('/api/auth/login').send({ identificador: '7654321', password: 'p', device: device('desktop') });
    const r2 = await request(app)
      .post('/api/auth/verify')
      .send({ challengeId: r1.body.challengeId, codigo: messenger.last, recordar: true, device: device('desktop') });
    expect(r2.body.trustToken).toBeTruthy();
    const r3 = await request(app)
      .post('/api/auth/login')
      .send({ identificador: '7654321', password: 'p', trustToken: r2.body.trustToken, device: device('desktop', r2.body.deviceId) });
    expect(r3.body.paso).toBe('listo');
  });

  it('kiosco: identifica por legajo + PIN y por QR; la sesión es efímera', async () => {
    const { ctx, app, orgId } = makeCtx();
    addUser(ctx, orgId, { dni: '5555555', legajo: '04817', password: 'p', pin: '1234', qr: 'QR-1' });
    const token = 'kiosk-token-para-pruebas-0123456789';
    const { sha256 } = await import('../src/crypto.ts');
    ctx.db.prepare("INSERT INTO kiosks (id, org_id, nombre, token_hash, creado_en) VALUES ('k1', ?, 'Tablet', ?, ?)").run(orgId, sha256(token), new Date().toISOString());

    const bad = await request(app).post('/api/auth/kiosk').send({ kioskToken: token, legajo: '04817', pin: '0000' });
    expect(bad.status).toBe(401);
    const ok = await request(app).post('/api/auth/kiosk').send({ kioskToken: token, legajo: '04817', pin: '1234' });
    expect(ok.status).toBe(200);
    const me = await request(app).get('/api/me').set(bearer(ok.body.token));
    expect(me.body.sesion.efimera).toBe(true);
    const qr = await request(app).post('/api/auth/kiosk').send({ kioskToken: token, qr: 'QR-1' });
    expect(qr.status).toBe(200);
    const unknownKiosk = await request(app).post('/api/auth/kiosk').send({ kioskToken: 'x'.repeat(30), qr: 'QR-1' });
    expect(unknownKiosk.status).toBe(401);
  });

  it('cerrar sesión en un dispositivo revoca sus sesiones', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '1111111', legajo: '1', password: 'p' });
    const a = await login(app, messenger, '1111111', 'p');
    const b = await login(app, messenger, '1111111', 'p', 'desktop');
    const del = await request(app).delete(`/api/devices/${b.deviceId}`).set(bearer(a.token));
    expect(del.status).toBe(200);
    const me = await request(app).get('/api/me').set(bearer(b.token));
    expect(me.status).toBe(401);
  });
});

describe('alcance del kiosco', () => {
  async function setup() {
    const env = makeCtx();
    addUser(env.ctx, env.orgId, { dni: '6060606', legajo: '777', password: 'p', pin: '1234' });
    const { sha256 } = await import('../src/crypto.ts');
    const token = 'kiosk-token-para-pruebas-0123456789';
    env.ctx.db.prepare("INSERT INTO kiosks (id, org_id, nombre, token_hash, creado_en) VALUES ('k1', ?, 'Tablet', ?, ?)").run(env.orgId, sha256(token), new Date().toISOString());
    // Historial previo hecho desde el teléfono.
    const phone = await login(env.app, env.messenger, '6060606', 'p');
    const old = checkin();
    await request(env.app)
      .post('/api/sync/push')
      .set(bearer(phone.token))
      .send({ mutations: [{ mutationId: randomUUID(), entity: 'checkin', id: old.id, op: 'upsert', data: old, updatedAt: old.updatedAt, deviceId: phone.deviceId }] });
    const k = await request(env.app).post('/api/auth/kiosk').send({ kioskToken: token, legajo: '777', pin: '1234' });
    return { ...env, phone, old, kiosk: k.body as { token: string; deviceId: string } };
  }

  it('la tablet no recibe el historial: solo lo registrado en esa sesión', async () => {
    const t = await setup();
    const empty = await request(t.app).get('/api/sync/pull?cursor=0').set(bearer(t.kiosk.token));
    expect(empty.body.cambios).toHaveLength(0);
    const c = checkin();
    await request(t.app)
      .post('/api/sync/push')
      .set(bearer(t.kiosk.token))
      .send({ mutations: [{ mutationId: randomUUID(), entity: 'checkin', id: c.id, op: 'upsert', data: c, updatedAt: c.updatedAt, deviceId: t.kiosk.deviceId }] });
    const mine = await request(t.app).get('/api/sync/pull?cursor=0').set(bearer(t.kiosk.token));
    expect(mine.body.cambios.map((x: { id: string }) => x.id)).toEqual([c.id]);
    // El teléfono sí ve los dos.
    const phone = await request(t.app).get('/api/sync/pull?cursor=0').set(bearer(t.phone.token));
    expect(phone.body.cambios).toHaveLength(2);
  });

  it('bloquea todo lo que no es del flujo del kiosco', async () => {
    const t = await setup();
    const k = bearer(t.kiosk.token);
    const blocked = [
      request(t.app).get('/api/privacy/export').set(k),
      request(t.app).delete('/api/privacy/history').set(k),
      request(t.app).post('/api/privacy/withdraw').set(k),
      request(t.app).get('/api/privacy/access-log').set(k),
      request(t.app).get('/api/devices').set(k),
      request(t.app).delete(`/api/devices/${t.phone.deviceId}`).set(k),
      request(t.app).put('/api/consents').set(k).send({ camara: false, animo: false, reaccion: false, chat: false, geo: false }),
      request(t.app).get('/api/companion/messages').set(k),
      request(t.app).post('/api/companion/messages').set(k).send({ text: 'hola' }),
    ];
    for (const r of await Promise.all(blocked)) {
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('no_disponible_en_kiosco');
    }
    // El teléfono sigue con su sesión abierta.
    expect((await request(t.app).get('/api/me').set(bearer(t.phone.token))).status).toBe(200);
    // Lo que el kiosco sí necesita, funciona.
    expect((await request(t.app).get('/api/me').set(k)).status).toBe(200);
    const e = await request(t.app)
      .post('/api/emergency')
      .set(k)
      .send({ id: randomUUID(), tipo: 'hablar', compartirUbicacion: false, creadoEn: new Date().toISOString(), origen: 'boton' });
    expect(e.status).toBe(200);
  });

  it('no puede modificar ni borrar check-ins hechos en otro dispositivo', async () => {
    const t = await setup();
    const later = new Date(Date.now() + 60_000).toISOString();
    const r = await request(t.app)
      .post('/api/sync/push')
      .set(bearer(t.kiosk.token))
      .send({
        mutations: [
          { mutationId: randomUUID(), entity: 'checkin', id: t.old.id, op: 'upsert', data: { ...t.old, nota: 'x', updatedAt: later }, updatedAt: later, deviceId: t.kiosk.deviceId },
          { mutationId: randomUUID(), entity: 'checkin', id: t.old.id, op: 'delete', data: null, updatedAt: later, deviceId: t.kiosk.deviceId },
        ],
      });
    expect(r.body.resultados.map((x: { status: string; motivo?: string }) => [x.status, x.motivo])).toEqual([
      ['rechazada', 'kiosco'],
      ['rechazada', 'kiosco'],
    ]);
  });
});

describe('sincronización de check-ins', () => {
  it('sube, recalcula el nivel en el servidor, es idempotente y resuelve conflictos por fecha', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '2222222', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '2222222', 'p');
    const c = checkin();
    const mutation = { mutationId: randomUUID(), entity: 'checkin', id: c.id, op: 'upsert', data: c, updatedAt: c.updatedAt, deviceId: s.deviceId };
    const p1 = await request(app).post('/api/sync/push').set(bearer(s.token)).send({ mutations: [mutation] });
    expect(p1.body.resultados[0].status).toBe('aplicada');
    const p2 = await request(app).post('/api/sync/push').set(bearer(s.token)).send({ mutations: [mutation] });
    expect(p2.body.resultados[0].status).toBe('duplicada');

    // Una edición más vieja no pisa a la más nueva.
    const older = { ...c, nota: 'vieja', updatedAt: new Date(Date.parse(c.updatedAt) - 60_000).toISOString() };
    const p3 = await request(app)
      .post('/api/sync/push')
      .set(bearer(s.token))
      .send({ mutations: [{ ...mutation, mutationId: randomUUID(), data: older, updatedAt: older.updatedAt }] });
    expect(p3.body.resultados[0].status).toBe('descartada');

    const pull = await request(app).get('/api/sync/pull?cursor=0').set(bearer(s.token));
    expect(pull.body.cambios).toHaveLength(1);
    expect(pull.body.cambios[0].data.nivel).toBe('moderado'); // estrés 3,1 → moderado con los umbrales por defecto
    expect(pull.body.cambios[0].data.nota).toBeNull();

    const pull2 = await request(app).get(`/api/sync/pull?cursor=${pull.body.cursor}`).set(bearer(s.token));
    expect(pull2.body.cambios).toHaveLength(0);

    // Los datos quedan cifrados en reposo.
    const row = ctx.db.prepare('SELECT payload_enc FROM checkins').get() as { payload_enc: string };
    expect(row.payload_enc.startsWith('v1.')).toBe(true);
    expect(row.payload_enc).not.toContain('312');
  });

  it('un usuario no puede pisar el check-in de otro', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '3333333', legajo: '1', password: 'p' });
    addUser(ctx, orgId, { dni: '4444444', legajo: '2', password: 'p' });
    const a = await login(app, messenger, '3333333', 'p');
    const b = await login(app, messenger, '4444444', 'p');
    const c = checkin();
    const m = (upd: string) => ({ mutationId: randomUUID(), entity: 'checkin', id: c.id, op: 'upsert', data: { ...c, updatedAt: upd }, updatedAt: upd, deviceId: 'x' });
    await request(app).post('/api/sync/push').set(bearer(a.token)).send({ mutations: [m(c.updatedAt)] });
    const later = new Date(Date.now() + 60_000).toISOString();
    const r = await request(app).post('/api/sync/push').set(bearer(b.token)).send({ mutations: [m(later)] });
    expect(r.body.resultados[0].status).toBe('rechazada');
  });
});

describe('consentimiento en el servidor', () => {
  async function setup() {
    const env = makeCtx();
    addUser(env.ctx, env.orgId, { dni: '1212121', legajo: '1', password: 'p' });
    const s = await login(env.app, env.messenger, '1212121', 'p');
    const push = (c: ReturnType<typeof checkin>) =>
      request(env.app)
        .post('/api/sync/push')
        .set(bearer(s.token))
        .send({ mutations: [{ mutationId: randomUUID(), entity: 'checkin', id: c.id, op: 'upsert', data: c, updatedAt: c.updatedAt, deviceId: s.deviceId }] });
    const consents = (c: Record<string, boolean>) =>
      request(env.app).put('/api/consents').set(bearer(s.token)).send({ camara: true, animo: true, reaccion: true, chat: true, geo: true, ...c });
    const pull = async () => (await request(env.app).get('/api/sync/pull?cursor=0').set(bearer(s.token))).body.cambios;
    return { ...env, s, push, consents, pull };
  }

  it('no guarda el escaneo si el permiso de cámara está apagado, aunque el dispositivo lo mande', async () => {
    const t = await setup();
    await t.consents({ camara: false });
    const r = await t.push(checkin());
    expect(r.body.resultados[0].status).toBe('aplicada');
    const [c] = await t.pull();
    expect(c.data.escaneo).toBeNull();
    expect(c.data.animo).toBe(3);
    // El nivel se recalcula sin el escaneo (solo autorreporte y reacción).
    expect(c.data.nivel).toBe('moderado');
  });

  it('rechaza check-ins después de retirar el consentimiento', async () => {
    const t = await setup();
    await request(t.app).post('/api/privacy/withdraw').set(bearer(t.s.token));
    const r = await t.push(checkin());
    expect(r.body.resultados[0]).toMatchObject({ status: 'rechazada', motivo: 'consentimiento_retirado' });
    expect(await t.pull()).toHaveLength(0);
  });

  it('rechaza si no queda ningún dato permitido', async () => {
    const t = await setup();
    await t.consents({ camara: false, animo: false, reaccion: false });
    const r = await t.push(checkin());
    expect(r.body.resultados[0]).toMatchObject({ status: 'rechazada', motivo: 'sin_datos_consentidos' });
  });
});

describe('acompañante', () => {
  it('responde y guarda cifrado; activa el estado de cuidado ante riesgo sin depender del modelo', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '5656565', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '5656565', 'p');
    const r1 = await request(app).post('/api/companion/messages').set(bearer(s.token)).send({ text: 'Estoy cansado' });
    expect(r1.body.cuidado).toBe(false);
    expect(r1.body.mensajes[1].text).toContain('respiración de 2 minutos');

    const r2 = await request(app)
      .post('/api/companion/messages')
      .set(bearer(s.token))
      .send({ text: 'A veces pienso que no quiero seguir. Que sería más fácil hacerme daño.' });
    expect(r2.body.cuidado).toBe(true);
    const list = await request(app).get('/api/companion/messages').set(bearer(s.token));
    expect(list.body.cuidado).toBe(true);
    expect(list.body.mensajes).toHaveLength(4);
    const raw = ctx.db.prepare('SELECT content_enc FROM chat_messages').all() as Array<{ content_enc: string }>;
    expect(raw.every((m) => !m.content_enc.includes('cansado'))).toBe(true);
  });
});

describe('emergencia', () => {
  it('avisa a la guardia una sola vez aunque el cliente reintente, y queda en el registro de accesos', async () => {
    const { ctx, app, orgId, messenger, guard } = makeCtx();
    addUser(ctx, orgId, { dni: '6767676', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '6767676', 'p');
    const body = {
      id: randomUUID(),
      tipo: 'fisica',
      compartirUbicacion: true,
      ubicacion: { lat: -31.5, lng: -68.5, precisionM: 12 },
      creadoEn: new Date().toISOString(),
      origen: 'boton',
    };
    const r1 = await request(app).post('/api/emergency').set(bearer(s.token)).send(body);
    const r2 = await request(app).post('/api/emergency').set(bearer(s.token)).send(body);
    expect(r1.body.estado).toBe('enviado');
    expect(r2.body.id).toBe(r1.body.id);
    expect(guard.sent).toHaveLength(1);
    expect(guard.sent[0]!.ubicacion).toEqual({ lat: -31.5, lng: -68.5, precisionM: 12 });
    const log = await request(app).get('/api/privacy/access-log').set(bearer(s.token));
    expect(log.body.compartida90d).toBe(1);
  });

  it('funciona aunque se haya retirado el consentimiento, pero sin ubicación', async () => {
    const { ctx, app, orgId, messenger, guard } = makeCtx();
    addUser(ctx, orgId, { dni: '7878787', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '7878787', 'p');
    await request(app).post('/api/privacy/withdraw').set(bearer(s.token));
    const r = await request(app)
      .post('/api/emergency')
      .set(bearer(s.token))
      .send({ id: randomUUID(), tipo: 'riesgo', compartirUbicacion: true, ubicacion: { lat: 1, lng: 1, precisionM: 1 }, creadoEn: new Date().toISOString(), origen: 'boton' });
    expect(r.status).toBe(200);
    expect(guard.sent[0]!.ubicacion).toBeNull();
  });
});

describe('clasificación del aviso a la guardia', () => {
  it('cada combinación de lo que eligió la persona y desde dónde', async () => {
    const { guardAlertType, guardAlertPriority } = await import('../src/notify.ts');
    const cases: Array<[Parameters<typeof guardAlertType>[0], Parameters<typeof guardAlertType>[1], string, string]> = [
      ['fisica', 'boton', 'emergencia_fisica', 'alta'],
      ['hablar', 'boton', 'hablar', 'normal'],
      ['riesgo', 'boton', 'riesgo', 'alta'],
      ['riesgo', 'resultado_alto', 'resultado_alto', 'alta'],
      ['hablar', 'acompanante', 'hablar', 'normal'], // "Hablar con una persona" desde el chat
      ['riesgo', 'acompanante', 'acompanante_cuidado', 'alta'], // estado de cuidado
      ['fisica', 'acompanante', 'emergencia_fisica', 'alta'], // lo físico siempre manda
    ];
    for (const [tipo, origen, esperado, prioridad] of cases) {
      const t = guardAlertType(tipo, origen);
      expect([tipo, origen, t]).toEqual([tipo, origen, esperado]);
      expect(guardAlertPriority(t)).toBe(prioridad);
    }
  });

  it('"Hablar con una persona" desde el acompañante llega a la guardia como pedido de charla, no como riesgo', async () => {
    const { ctx, app, orgId, messenger, guard } = makeCtx();
    addUser(ctx, orgId, { dni: '4545454', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '4545454', 'p');
    const send = (tipo: string) =>
      request(app)
        .post('/api/emergency')
        .set(bearer(s.token))
        .send({ id: randomUUID(), tipo, compartirUbicacion: false, creadoEn: new Date().toISOString(), origen: 'acompanante' });
    await send('hablar');
    await send('riesgo');
    expect(guard.sent.map((a) => [a.tipo, a.prioridad, a.origen])).toEqual([
      ['hablar', 'normal', 'acompanante'],
      ['acompanante_cuidado', 'alta', 'acompanante'],
    ]);
  });
});

describe('privacidad', () => {
  it('borrar mi historial deja tombstones que se sincronizan', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '8989898', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '8989898', 'p');
    const c = checkin();
    await request(app)
      .post('/api/sync/push')
      .set(bearer(s.token))
      .send({ mutations: [{ mutationId: randomUUID(), entity: 'checkin', id: c.id, op: 'upsert', data: c, updatedAt: c.updatedAt, deviceId: s.deviceId }] });
    await request(app).delete('/api/privacy/history').set(bearer(s.token));
    const pull = await request(app).get('/api/sync/pull?cursor=0').set(bearer(s.token));
    expect(pull.body.cambios[0].deleted).toBe(true);
    const exp = await request(app).get('/api/privacy/export').set(bearer(s.token));
    expect(exp.body.checkins).toHaveLength(0);
  });
});
