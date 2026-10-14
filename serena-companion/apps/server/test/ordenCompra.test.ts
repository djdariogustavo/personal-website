import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { addUser, login, makeCtx } from './helpers.ts';
import { MercadoPagoProvider } from '../src/payments/mercadopago.ts';
import { OrdenCompraProvider, textoProforma } from '../src/payments/ordenCompra.ts';
import { leerTransferencia } from '../src/env.ts';
import { generarPdf } from '../src/pdf.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const FACTURACION = {
  razonSocial: 'Minera Ejemplo S.A.',
  cuit: '30-71234567-1',
  condicionIva: 'responsable_inscripto',
  domicilioFiscal: 'Av. Siempre Viva 742, San Juan',
  contactoNombre: 'Compras Minera',
  contactoEmail: 'compras@minera.example',
  ordenInterna: 'PO-4500012345',
};

async function sesionAdmin() {
  const env = makeCtx();
  addUser(env.ctx, env.orgId, { role: 'admin', dni: '9999999', usuario: 'admin', legajo: 'A1', password: 'p' });
  const s = await login(env.app, env.messenger, 'admin', 'p', 'desktop');
  const oc = env.ctx.payments.get('orden_compra') as OrdenCompraProvider;
  return { ...env, token: s.token, oc };
}

const empresa = (puestos: number, extra: Record<string, unknown> = {}) => ({ proveedor: 'orden_compra', planId: 'faena-mensual', puestos, moneda: 'ARS', facturacion: FACTURACION, ...extra });

describe('plan Empresa: orden de compra', () => {
  it('valida mínimo de 10 puestos, datos de facturación y CUIT', async () => {
    const { app, token } = await sesionAdmin();
    const post = (b: object) => request(app).post('/api/admin/billing/checkout').set(bearer(token)).send(b);
    expect((await post(empresa(9))).body.error).toBe('minimo_puestos');
    const { facturacion: _f, ...sinDatos } = empresa(10);
    expect((await post(sinDatos)).body.error).toBe('facturacion');
    expect((await post(empresa(10, { facturacion: { ...FACTURACION, cuit: '30-71234567-2' } }))).status).toBe(400);
    // El plan Empresa no se paga con Mercado Pago, y el Individual no va por orden de compra.
    expect((await post({ ...empresa(10), planId: 'individual-mensual', puestos: 1 })).body.error).toBe('proveedor_no_admitido');
  });

  it('emite la orden con número correlativo, deja la suscripción pendiente con los puestos habilitados y la envía por email con el PDF', async () => {
    const { app, token, ordenesNotificadas } = await sesionAdmin();
    const r = await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send(empresa(12));
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^\/admin\/facturacion\/orden\/[0-9a-f-]{36}$/);
    const id = r.body.url.split('/').pop();

    const billing = await request(app).get('/api/admin/billing').set(bearer(token));
    expect(billing.body.suscripcion).toMatchObject({ estado: 'orden_pendiente', proveedor: 'orden_compra', puestos: 12, planId: 'faena-mensual' });

    const det = await request(app).get(`/api/admin/billing/ordenes/${id}`).set(bearer(token));
    expect(det.body.orden).toMatchObject({ numero: 'OC-000001', estado: 'pendiente', puestos: 12, precioUnitario: 900_000, total: 10_800_000 });
    expect(det.body.orden.facturacion.cuit).toBe('30712345671');
    expect(det.body.transferencia.cbu).toBe('0000003100000000000001');
    // La proforma dice a qué casilla enviar el comprobante.
    expect(textoProforma(det.body.orden, det.body.transferencia, 'Org')).toContain('enviar el comprobante a cobranzas@serena.test.');
    expect(textoProforma(det.body.orden, { ...det.body.transferencia, email: null }, 'Org')).toContain('enviar el comprobante al contacto de SERENA.');

    const pdf = await request(app).get(`/api/admin/billing/ordenes/${id}/pdf`).set(bearer(token)).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await new Promise((ok) => setTimeout(ok, 0));
    expect(ordenesNotificadas).toHaveLength(1);
    expect(ordenesNotificadas[0]!.numero).toBe('OC-000001');
    expect(ordenesNotificadas[0]!.pdf.subarray(0, 5).toString()).toBe('%PDF-');

    // No se puede emitir otra mientras haya una pendiente.
    expect((await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send(empresa(12))).status).toBe(409);

    // La segunda orden (tras anular la primera) sigue la numeración correlativa.
    await request(app).post('/api/admin/billing/cancel').set(bearer(token)).send({});
    const r2 = await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send(empresa(15));
    const det2 = await request(app).get(`/api/admin/billing/ordenes/${r2.body.url.split('/').pop()}`).set(bearer(token));
    expect(det2.body.orden.numero).toBe('OC-000002');
    expect((await request(app).get('/api/admin/billing/ordenes').set(bearer(token))).body.ordenes.map((o: { numero: string }) => o.numero)).toEqual(['OC-000002', 'OC-000001']);
  });

  it('solo un operador de SERENA marca la orden como pagada: activa la suscripción y fija el vencimiento', async () => {
    const { app, token, oc } = await sesionAdmin();
    await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send(empresa(10));
    // La API de la empresa no tiene forma de marcarla pagada.
    expect((await request(app).post('/api/admin/billing/ordenes/x/pagada').set(bearer(token)).send({})).status).toBe(404);

    const o = oc.marcarPagada('OC-000001', { fecha: '2026-10-12', referencia: 'TRF 123456', numeroFactura: 'A-0001-00000012' });
    expect(o).toMatchObject({ estado: 'pagada', referenciaPago: 'TRF 123456', numeroFactura: 'A-0001-00000012' });
    const s = (await request(app).get('/api/admin/billing').set(bearer(token))).body.suscripcion;
    expect(s.estado).toBe('activa');
    expect(s.proximoCobro.slice(0, 10)).toBe('2026-11-12');
    // Repetir el mismo registro no duplica nada.
    expect(oc.marcarPagada('OC-000001', { fecha: '2026-10-12', referencia: 'TRF 123456' }).estado).toBe('pagada');
    expect(() => oc.marcarVencida('OC-000001')).toThrow(/no está pendiente/);
    expect(oc.registrarFactura('1', 'A-0001-00000013').numeroFactura).toBe('A-0001-00000013');
  });

  it('una orden vencida pasa la suscripción a pago vencido sin bloquear el botón de emergencia', async () => {
    const { app, token, oc, ctx, orgId, messenger } = await sesionAdmin();
    await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send(empresa(10));
    oc.marcarVencida('OC-000001');
    expect((await request(app).get('/api/admin/billing').set(bearer(token))).body.suscripcion.estado).toBe('pago_vencido');
    addUser(ctx, orgId, { dni: '30111222', legajo: '7', password: 'p' });
    const w = await login(app, messenger, '30111222', 'p');
    const ayuda = await request(app).post('/api/emergency').set(bearer(w.token)).send({ id: crypto.randomUUID(), tipo: 'fisica', compartirUbicacion: false, creadoEn: new Date().toISOString(), origen: 'boton' });
    expect(ayuda.status).toBe(200);
  });

  it('cancelar una orden sin pagar la anula y cancela la suscripción en el acto', async () => {
    const { app, token } = await sesionAdmin();
    const r = await request(app).post('/api/admin/billing/checkout').set(bearer(token)).send(empresa(10));
    const c = await request(app).post('/api/admin/billing/cancel').set(bearer(token)).send({});
    expect(c.body.suscripcion.estado).toBe('cancelada');
    const det = await request(app).get(`/api/admin/billing/ordenes/${r.body.url.split('/').pop()}`).set(bearer(token));
    expect(det.body.orden.estado).toBe('anulada');
  });
});

describe('plan Individual: Mercado Pago', () => {
  it('1 puesto, checkout, webhook firmado y suscripción activa', async () => {
    const { app, token, ctx } = await sesionAdmin();
    const enviados: Array<Record<string, unknown>> = [];
    let preapproval: Record<string, unknown> = {};
    const fetchFalso = (async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        const b = JSON.parse(String(init.body));
        enviados.push(b);
        preapproval = { id: 'pre-77', status: 'authorized', external_reference: b.external_reference, payer_id: 42, next_payment_date: '2026-11-12T00:00:00.000Z' };
        return new Response(JSON.stringify({ id: 'pre-77', init_point: 'https://mp.example/pay', status: 'pending' }), { status: 201 });
      }
      expect(url).toMatch(/\/preapproval\/pre-77$/);
      return new Response(JSON.stringify(preapproval), { status: 200 });
    }) as typeof fetch;
    ctx.payments.register(new MercadoPagoProvider('TEST-x', 'clave-webhook', 'ARS', fetchFalso));

    const post = (b: object) => request(app).post('/api/admin/billing/checkout').set(bearer(token)).send(b);
    const base = { proveedor: 'mercadopago', planId: 'individual-mensual', moneda: 'ARS', emailPago: 'test_user@testuser.com' };
    expect((await post({ ...base, puestos: 2 })).body.error).toBe('maximo_puestos');
    const ok = await post({ ...base, puestos: 1 });
    expect(ok.body.url).toBe('https://mp.example/pay');
    expect(enviados[0]).toMatchObject({ payer_email: 'test_user@testuser.com', reason: 'SERENA · Individual · mensual · 1 puesto' });
    expect((enviados[0]!.auto_recurring as { transaction_amount: number }).transaction_amount).toBe(15_000);

    const ts = String(Math.floor(Date.now() / 1000));
    const firma = createHmac('sha256', 'clave-webhook').update(`id:pre-77;request-id:req-1;ts:${ts};`).digest('hex');
    const wh = await request(app)
      .post('/api/billing/webhooks/mercadopago?type=subscription_preapproval&data.id=pre-77')
      .set('content-type', 'application/json')
      .set('x-signature', `ts=${ts},v1=${firma}`)
      .set('x-request-id', 'req-1')
      .send(JSON.stringify({ type: 'subscription_preapproval', data: { id: 'pre-77' } }));
    expect(wh.status).toBe(200);
    const s = (await request(app).get('/api/admin/billing').set(bearer(token))).body.suscripcion;
    expect(s).toMatchObject({ estado: 'activa', proveedor: 'mercadopago', planId: 'individual-mensual', puestos: 1 });
  });
});

describe('SERENA_TRANSFERENCIA_JSON', () => {
  const base = { titular: 'SERENA SRL', cuit: '30712345671', banco: 'Banco', cbu: '0000003100000000000001' };
  it('acepta el email de cobranzas y descarta uno mal escrito, sin frenar las órdenes', () => {
    expect(leerTransferencia(JSON.stringify({ ...base, email: ' cobranzas@serena.test ' })).email).toBe('cobranzas@serena.test');
    expect(leerTransferencia(JSON.stringify(base)).email).toBeUndefined();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(leerTransferencia(JSON.stringify({ ...base, email: 'cobranzas@' })).email).toBeNull();
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});

describe('PDF', () => {
  it('genera un PDF válido con acentos y varias páginas', () => {
    const pdf = generarPdf(Array.from({ length: 120 }, (_, i) => ({ texto: `Línea ${i} · razón social, año, CUIT — (prueba) ¿ñandú?` })), 'Prueba');
    const s = pdf.toString('latin1');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toMatch(/\/Count [2-9]/);
    expect(s).toContain('L\\355nea');
    expect(s).toContain('\\(prueba\\)');
  });
});
