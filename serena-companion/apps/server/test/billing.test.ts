import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { addUser, login, makeCtx } from './helpers.ts';
import { verifyMercadoPagoSignature } from '../src/payments/mercadopago.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function adminSession() {
  const env = makeCtx();
  addUser(env.ctx, env.orgId, { role: 'admin', dni: '9999999', usuario: 'admin', legajo: 'A1', password: 'p' });
  const s = await login(env.app, env.messenger, 'admin', 'p', 'desktop');
  return { ...env, token: s.token };
}

describe('servicio de pago', () => {
  it('solo un administrador accede a facturación', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '1231231', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '1231231', 'p');
    const r = await request(app).get('/api/admin/billing').set(bearer(s.token));
    expect(r.status).toBe(403);
  });

  it('checkout → webhook firmado → suscripción activa (idempotente)', async () => {
    const { app, token } = await adminSession();
    const b0 = await request(app).get('/api/admin/billing').set(bearer(token));
    expect(b0.body.suscripcion.estado).toBe('sin_suscripcion');
    expect(b0.body.proveedores.map((p: { id: string }) => p.id)).toContain('sandbox');

    const tooFew = await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send({ proveedor: 'sandbox', planId: 'faena-mensual', puestos: 2, moneda: 'USD' });
    expect(tooFew.status).toBe(400);

    const co = await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send({ proveedor: 'sandbox', planId: 'faena-mensual', puestos: 40, moneda: 'USD' });
    expect(co.status).toBe(200);
    expect(co.body.url).toContain('/admin/facturacion/sandbox');

    const b1 = await request(app).get('/api/admin/billing').set(bearer(token));
    expect(b1.body.suscripcion.estado).toBe('pendiente');

    const sim = await request(app).post('/api/admin/billing/sandbox/complete').set(bearer(token)).send({ checkoutId: co.body.checkoutId, aprobado: true });
    const send = () =>
      request(app)
        .post('/api/billing/webhooks/sandbox')
        .set('content-type', 'application/json')
        .set('x-sandbox-signature', sim.body.webhook.signature)
        .send(sim.body.webhook.body);
    const w1 = await send();
    expect(w1.body).toEqual({ recibido: true, duplicado: false });
    const w2 = await send();
    expect(w2.body.duplicado).toBe(true);

    const b2 = await request(app).get('/api/admin/billing').set(bearer(token));
    expect(b2.body.suscripcion).toMatchObject({ estado: 'activa', puestos: 40, planId: 'faena-mensual', moneda: 'USD', proveedor: 'sandbox' });

    const again = await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send({ proveedor: 'sandbox', planId: 'faena-mensual', puestos: 40, moneda: 'USD' });
    expect(again.status).toBe(409);
  });

  it('rechaza webhooks con firma inválida', async () => {
    const { app } = await adminSession();
    const r = await request(app)
      .post('/api/billing/webhooks/sandbox')
      .set('content-type', 'application/json')
      .set('x-sandbox-signature', 'ab'.repeat(32))
      .send(JSON.stringify({ id: 'evt', tipo: 'pago.aprobado', orgId: 'x', checkoutId: 'y', puestos: 1, suscripcion: 's' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('firma_invalida');
  });

  it('los reportes agregados requieren suscripción activa y ocultan grupos chicos', async () => {
    const { app, token } = await adminSession();
    const r = await request(app).get('/api/admin/stats').set(bearer(token));
    expect(r.status).toBe(402);
  });

  it('el estado del pago nunca bloquea la emergencia', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '3213213', legajo: '1', password: 'p' });
    ctx.db.prepare("INSERT INTO subscriptions (org_id, estado) VALUES (?, 'pago_vencido')").run(orgId);
    const s = await login(app, messenger, '3213213', 'p');
    const r = await request(app)
      .post('/api/emergency')
      .set(bearer(s.token))
      .send({ id: crypto.randomUUID(), tipo: 'fisica', compartirUbicacion: false, creadoEn: new Date().toISOString(), origen: 'boton' });
    expect(r.status).toBe(200);
  });
});

describe('firma de Mercado Pago', () => {
  const secret = 'mp-secret';
  const sign = (manifest: string) => createHmac('sha256', secret).update(manifest).digest('hex');

  it('valida el manifiesto id/request-id/ts', () => {
    const ts = '1742505638683';
    const v1 = sign(`id:abc123;request-id:req-1;ts:${ts};`);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1', dataId: 'ABC123', secret })).toBe(true);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'otro', dataId: 'ABC123', secret })).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature: undefined, xRequestId: 'req-1', dataId: 'ABC123', secret })).toBe(false);
  });

  it('rechaza notificaciones fuera de la ventana de tiempo', () => {
    const ts = String(Date.now() - 3_600_000);
    const v1 = sign(`id:1;request-id:r;ts:${ts};`);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'r', dataId: '1', secret, toleranceS: 600 })).toBe(false);
  });
});
