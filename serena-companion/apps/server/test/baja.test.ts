import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { addUser, login, makeCtx } from './helpers.ts';
import { sha256 } from '../src/crypto.ts';
import { BAJA_GRACIA_DIAS, purgarVencidas } from '../src/baja.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const KIOSK = 'kiosco-de-prueba-con-token-largo';

async function escenario() {
  const env = makeCtx();
  const { ctx, app, orgId, messenger } = env;
  addUser(ctx, orgId, { role: 'admin', dni: '9999999', usuario: 'admin', legajo: 'A1', password: 'p' });
  const workerId = addUser(ctx, orgId, { dni: '30111222', legajo: '777', password: 'pw', pin: '4829', qr: 'QR-777' });
  ctx.db.prepare("INSERT INTO kiosks (id, org_id, nombre, token_hash, creado_en) VALUES ('k1', ?, 'Tablet', ?, ?)").run(orgId, sha256(KIOSK), new Date().toISOString());
  ctx.db.prepare("INSERT INTO subscriptions (org_id, estado, puestos) VALUES (?, 'activa', 1)").run(orgId);
  const admin = await login(app, messenger, 'admin', 'p', 'desktop');
  const phone = await login(app, messenger, '30111222', 'pw');
  // Un check-in para verificar que la persona puede descargarlo después de la baja.
  const now = new Date().toISOString();
  const c = {
    id: randomUUID(), createdAt: now, updatedAt: now, deviceName: 'Tel', deviceKind: 'mobile', rosterDay: 3, onShift: true,
    animo: 2, sueno: 2, escaneo: null, reaccion: null, voz: null, nivel: 'bajo', nota: 'dato propio',
  };
  const push = await request(app).post('/api/sync/push').set(bearer(phone.token)).send({ mutations: [{ mutationId: randomUUID(), entity: 'checkin', id: c.id, op: 'upsert', data: c, updatedAt: c.updatedAt, deviceId: phone.deviceId }] });
  if (push.status !== 200) throw new Error(JSON.stringify(push.body));
  return { ...env, admin, phone, workerId };
}

describe('baja de trabajadores', () => {
  it('libera el puesto, cierra sesiones e invalida PIN y QR del kiosco', async () => {
    const { app, admin, phone, workerId } = await escenario();
    const antes = await request(app).get('/api/admin/workers').set(bearer(admin.token));
    expect(antes.body.suscripcion.puestosEnUso).toBe(1);
    expect(Object.keys(antes.body.trabajadores[0]).sort()).toEqual(['baja', 'estado', 'id', 'legajo', 'nombre', 'puesto']);

    const b = await request(app).post(`/api/admin/workers/${workerId}/baja`).set(bearer(admin.token));
    expect(b.status).toBe(200);
    expect(Date.parse(b.body.purgaEn) - Date.parse(b.body.desde)).toBe(BAJA_GRACIA_DIAS * 86_400_000);

    const despues = await request(app).get('/api/admin/workers').set(bearer(admin.token));
    expect(despues.body.suscripcion.puestosEnUso).toBe(0);
    expect(despues.body.trabajadores[0].estado).toBe('baja');

    expect((await request(app).get('/api/me').set(bearer(phone.token))).status).toBe(401);
    expect((await request(app).post('/api/auth/kiosk').send({ kioskToken: KIOSK, legajo: '777', pin: '4829' })).status).toBe(401);
    expect((await request(app).post('/api/auth/kiosk').send({ kioskToken: KIOSK, qr: 'QR-777' })).status).toBe(401);
  });

  it('durante el período de gracia la persona solo puede ver, descargar o eliminar sus datos', async () => {
    const { app, admin, workerId, messenger, ctx, orgId } = await escenario();
    await request(app).post(`/api/admin/workers/${workerId}/baja`).set(bearer(admin.token));
    const s = await login(app, messenger, '30111222', 'pw');
    const me = await request(app).get('/api/me').set(bearer(s.token));
    expect(me.body.perfil.baja.purgaEn).toBeTruthy();
    const exp = await request(app).get('/api/privacy/export').set(bearer(s.token));
    expect(exp.status).toBe(200);
    expect(exp.body.checkins[0].nota).toBe('dato propio');
    for (const [m, url] of [['post', '/api/emergency'], ['get', '/api/sync/pull'], ['post', '/api/sync/push'], ['get', '/api/companion/messages'], ['put', '/api/consents']] as const) {
      const r = await request(app)[m](url).set(bearer(s.token)).send({});
      expect(r.status, url).toBe(403);
      expect(r.body.error).toBe('cuenta_dada_de_baja');
    }
    const del = await request(app).delete('/api/privacy/account').set(bearer(s.token));
    expect(del.status).toBe(200);
    for (const t of ['users', 'checkins', 'devices', 'sessions', 'consents'])
      expect(ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${t === 'users' ? 'id' : 'user_id'} = ?`).get(workerId)).toEqual({ n: 0 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?').get(workerId)).toEqual({ n: 0 });
    expect(ctx.db.prepare("SELECT user_id FROM audit_log WHERE org_id = ? AND accion = 'cuenta_eliminada_por_la_persona'").get(orgId)).toEqual({ user_id: null });
    expect((await request(app).get('/api/me').set(bearer(s.token))).status).toBe(401);
  });

  it('una persona activa no puede eliminar la cuenta (sí borrar historial)', async () => {
    const { app, phone } = await escenario();
    expect((await request(app).delete('/api/privacy/account').set(bearer(phone.token))).status).toBe(403);
    expect((await request(app).delete('/api/privacy/history').set(bearer(phone.token))).status).toBe(200);
  });

  it('al vencer el período de gracia la cuenta y sus datos se eliminan y ya no se puede ingresar', async () => {
    const { app, admin, workerId, ctx, messenger } = await escenario();
    await request(app).post(`/api/admin/workers/${workerId}/baja`).set(bearer(admin.token));
    expect(purgarVencidas(ctx)).toBe(0);
    expect(purgarVencidas(ctx, new Date(Date.now() + (BAJA_GRACIA_DIAS + 1) * 86_400_000))).toBe(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?').get(workerId)).toEqual({ n: 0 });
    await expect(login(app, messenger, '30111222', 'pw')).rejects.toThrow();
  });

  it('la cuenta vencida no entra aunque todavía no haya corrido la purga', async () => {
    const { app, admin, workerId, ctx, messenger } = await escenario();
    await request(app).post(`/api/admin/workers/${workerId}/baja`).set(bearer(admin.token));
    const s = await login(app, messenger, '30111222', 'pw');
    ctx.db.prepare('UPDATE users SET purga_en = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), workerId);
    expect((await request(app).get('/api/me').set(bearer(s.token))).status).toBe(401);
    await expect(login(app, messenger, '30111222', 'pw')).rejects.toThrow();
  });

  it('reactivar requiere puesto libre y emite PIN y QR nuevos', async () => {
    const { app, admin, workerId, ctx, orgId } = await escenario();
    await request(app).post(`/api/admin/workers/${workerId}/baja`).set(bearer(admin.token));
    // Mientras tanto se ocupó el único puesto.
    addUser(ctx, orgId, { dni: '30999888', legajo: '888', password: 'x' });
    const sin = await request(app).post(`/api/admin/workers/${workerId}/reactivar`).set(bearer(admin.token));
    expect(sin.status).toBe(409);
    expect(sin.body.error).toBe('sin_puestos');
    ctx.db.prepare('UPDATE subscriptions SET puestos = 2 WHERE org_id = ?').run(orgId);
    const ok = await request(app).post(`/api/admin/workers/${workerId}/reactivar`).set(bearer(admin.token));
    expect(ok.status).toBe(200);
    const { pinKiosco, qrCredencial } = ok.body.credenciales;
    expect(pinKiosco).toMatch(/^\d{4}$/);
    expect((await request(app).post('/api/auth/kiosk').send({ kioskToken: KIOSK, qr: 'QR-777' })).status).toBe(401);
    expect((await request(app).post('/api/auth/kiosk').send({ kioskToken: KIOSK, qr: qrCredencial })).status).toBe(200);
    expect((await request(app).post('/api/auth/kiosk').send({ kioskToken: KIOSK, legajo: '777', pin: pinKiosco })).status).toBe(200);
  });

  it('no se puede dar de alta de nuevo a alguien en baja: hay que reactivarlo', async () => {
    const { app, admin, workerId } = await escenario();
    await request(app).post(`/api/admin/workers/${workerId}/baja`).set(bearer(admin.token));
    const r = await request(app)
      .post('/api/admin/workers')
      .set(bearer(admin.token))
      .send({ nombre: 'Persona Test', nombreCorto: 'Persona', dni: '30.111.222', legajo: '999', rosterInicio: '2026-09-01' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('en_baja');
  });

  it('una empresa no puede dar de baja a personas de otra ni a administradores', async () => {
    const a = await escenario();
    const b = await escenario();
    expect((await request(a.app).post(`/api/admin/workers/${b.workerId}/baja`).set(bearer(a.admin.token))).status).toBe(404);
    expect((await request(a.app).post(`/api/admin/workers/${a.admin.perfil.id}/baja`).set(bearer(a.admin.token))).status).toBe(404);
    expect((await request(a.app).post(`/api/admin/workers/${a.workerId}/baja`).set(bearer(a.phone.token))).status).toBe(403);
  });
});
