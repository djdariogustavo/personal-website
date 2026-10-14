import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { addUser, login, makeCtx } from './helpers.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

afterEach(() => vi.restoreAllMocks());

describe('diagnóstico del escaneo', () => {
  it('registra el código y la duración de la inicialización del SDK con el navegador, sin datos de la persona', async () => {
    const { app, ctx, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '30111222', usuario: 'ana', legajo: 'L1', password: 'p' });
    const { token } = await login(app, messenger, 'ana', 'p');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await request(app)
      .post('/api/escaneo/diagnostico')
      .set(bearer(token))
      .set('user-agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/129')
      .send({ resultado: 'CONNECTION_ERROR', ms: 12_345 });
    expect(r.status).toBe(204);
    const linea = warn.mock.calls.flat().join(' ');
    expect(linea).toContain('CONNECTION_ERROR en 12.3 s · Mozilla/5.0 (Linux; Android 14) Chrome/129');
    expect(linea).not.toContain('ana');
  });

  it('rechaza datos fuera de formato y pide sesión', async () => {
    const { app, ctx, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '30111222', usuario: 'ana', legajo: 'L1', password: 'p' });
    const { token } = await login(app, messenger, 'ana', 'p');
    expect((await request(app).post('/api/escaneo/diagnostico').set(bearer(token)).send({ resultado: 'texto libre <script>', ms: 1 })).status).toBe(400);
    expect((await request(app).post('/api/escaneo/diagnostico').send({ resultado: 'OK', ms: 1 })).status).toBe(401);
  });
});
