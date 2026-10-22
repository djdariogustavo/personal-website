import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { EmisorTokensEscaneo, ErrorTokenEscaneo } from '../src/escaneoToken.ts';
import { addUser, login, makeCtx } from './helpers.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const TOKEN = `sh_${'a1'.repeat(16)}`;

/** fetch falso del proveedor: registra el pedido y responde lo indicado. */
function proveedor(estado: number, cuerpo: unknown) {
  const pedidos: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, pedidos };
}

afterEach(() => vi.restoreAllMocks());

describe('emisor de tokens del escaneo (Shen.AI)', () => {
  it('pide un token de un solo dispositivo, vida corta y pocas mediciones, con la credencial en el encabezado', async () => {
    const { f, pedidos } = proveedor(200, { token: TOKEN, expires_at: '2026-10-21T16:00:00Z' });
    const t = await new EmisorTokensEscaneo({ adminKey: 'adm-secreta', fetch: f }).emitir();
    expect(t).toEqual({ token: TOKEN, expiraEn: '2026-10-21T16:00:00Z' });
    expect(pedidos[0]!.url).toBe('https://api.shen.ai/v1/token');
    expect((pedidos[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer adm-secreta');
    expect(JSON.parse(String(pedidos[0]!.init.body))).toEqual({ expires_in: 900, single_device: true, max_measurements: 3 });
  });

  it('acota la vida del token a lo que admite el proveedor (60 s a 24 h) y envía la licencia si se indica', async () => {
    const { f, pedidos } = proveedor(200, { token: TOKEN, expires_at: '2026-10-21T16:00:00Z' });
    await new EmisorTokensEscaneo({ adminKey: 'k', fetch: f, ttlS: 5 }).emitir();
    await new EmisorTokensEscaneo({ adminKey: 'k', fetch: f, ttlS: 999_999, licenseId: 7, maxMediciones: 1 }).emitir();
    expect(JSON.parse(String(pedidos[0]!.init.body)).expires_in).toBe(60);
    expect(JSON.parse(String(pedidos[1]!.init.body))).toEqual({ expires_in: 86_400, single_device: true, max_measurements: 1, license_id: 7 });
  });

  it('una credencial rechazada avisa a operaciones y no expone la clave', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const avisar = vi.fn();
    const { f } = proveedor(403, { code: 'FORBIDDEN' });
    const e = await new EmisorTokensEscaneo({ adminKey: 'adm-secreta', fetch: f, aviso: { avisar } }).emitir().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorTokenEscaneo);
    expect((e as ErrorTokenEscaneo).estado).toBe(403);
    expect(avisar).toHaveBeenCalledWith('shenai:403', expect.any(String), expect.stringContaining('tokens:generate'));
    expect(JSON.stringify(avisar.mock.calls)).not.toContain('adm-secreta');
  });

  it('rechaza una respuesta sin un token con el formato del proveedor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { f } = proveedor(200, { token: 'otra-cosa' });
    await expect(new EmisorTokensEscaneo({ adminKey: 'k', fetch: f }).emitir()).rejects.toMatchObject({ codigo: 'RESPUESTA_INVALIDA' });
  });
});

describe('POST /api/escaneo/token', () => {
  async function preparar(emisor: EmisorTokensEscaneo | null) {
    const { app: _app, ctx, orgId, messenger } = makeCtx();
    ctx.escaneoTokens = emisor;
    const app = createApp(ctx);
    addUser(ctx, orgId, { dni: '30111222', usuario: 'ana', legajo: 'L1', password: 'p' });
    const { token } = await login(app, messenger, 'ana', 'p');
    return { app, ctx, token };
  }

  it('entrega el token a la persona con consentimiento de cámara, sin caché', async () => {
    const { f } = proveedor(200, { token: TOKEN, expires_at: '2026-10-21T16:00:00Z' });
    const { app, token } = await preparar(new EmisorTokensEscaneo({ adminKey: 'k', fetch: f }));
    const r = await request(app).post('/api/escaneo/token').set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ token: TOKEN, expiraEn: '2026-10-21T16:00:00Z' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('exige sesión', async () => {
    const { f } = proveedor(200, { token: TOKEN });
    const { app } = await preparar(new EmisorTokensEscaneo({ adminKey: 'k', fetch: f }));
    expect((await request(app).post('/api/escaneo/token')).status).toBe(401);
  });

  it('sin consentimiento de cámara no se emite', async () => {
    const { f, pedidos } = proveedor(200, { token: TOKEN });
    const { app, ctx, token } = await preparar(new EmisorTokensEscaneo({ adminKey: 'k', fetch: f }));
    ctx.db.prepare('UPDATE consents SET camara = 0').run();
    const r = await request(app).post('/api/escaneo/token').set(bearer(token));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('sin_consentimiento');
    expect(pedidos).toHaveLength(0);
  });

  it('sin credencial en el servidor responde que no hay licencia', async () => {
    const { app, token } = await preparar(null);
    const r = await request(app).post('/api/escaneo/token').set(bearer(token));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('escaneo_sin_tokens');
  });

  it('si el proveedor falla, responde con un código propio (no lo confunde con falta de red)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { f } = proveedor(500, { code: 'SERVER_ERROR' });
    const { app, token } = await preparar(new EmisorTokensEscaneo({ adminKey: 'k', fetch: f }));
    const r = await request(app).post('/api/escaneo/token').set(bearer(token));
    expect(r.status).toBe(502);
    expect(r.body.error).toBe('escaneo_sin_licencia');
  });

  it('limita los pedidos por persona', async () => {
    const { f } = proveedor(200, { token: TOKEN, expires_at: '2026-10-21T16:00:00Z' });
    const { app, token } = await preparar(new EmisorTokensEscaneo({ adminKey: 'k', fetch: f }));
    let ultimo = 0;
    for (let i = 0; i < 21; i++) ultimo = (await request(app).post('/api/escaneo/token').set(bearer(token))).status;
    expect(ultimo).toBe(429);
  });
});
