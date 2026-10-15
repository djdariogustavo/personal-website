import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
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

  it('registra la etapa, las descargas del SDK y el equipo', async () => {
    const { app, ctx, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '30111222', usuario: 'ana', legajo: 'L1', password: 'p' });
    const { token } = await login(app, messenger, 'ana', 'p');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await request(app)
      .post('/api/escaneo/diagnostico')
      .set(bearer(token))
      .send({ resultado: 'CARGA_FALLIDA', etapa: 'crear', ms: 8000, wasmBytes: 36_200_000, moduloEstado: 200, memoriaGb: 4, nucleos: 8, aislado: true });
    expect(warn.mock.calls.flat().join(' ')).toContain('CARGA_FALLIDA en 8.0 s · etapa crear · módulo HTTP 200 · WASM 36.2 MB · memoria 4 GB · 8 núcleos · aislado');
  });

  it('incluye el detalle del error en una sola línea', async () => {
    const { app, ctx, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '30111222', usuario: 'ana', legajo: 'L1', password: 'p' });
    const { token } = await login(app, messenger, 'ana', 'p');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await request(app)
      .post('/api/escaneo/diagnostico')
      .set(bearer(token))
      .send({ resultado: 'CARGA_FALLIDA', ms: 900, detalle: 'TypeError: Failed to fetch\nmodule' });
    expect(warn.mock.calls.flat().join(' ')).toContain('CARGA_FALLIDA en 0.9 s · TypeError: Failed to fetch module ·');
  });

  it('rechaza datos fuera de formato y pide sesión', async () => {
    const { app, ctx, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '30111222', usuario: 'ana', legajo: 'L1', password: 'p' });
    const { token } = await login(app, messenger, 'ana', 'p');
    expect((await request(app).post('/api/escaneo/diagnostico').set(bearer(token)).send({ resultado: 'texto libre <script>', ms: 1 })).status).toBe(400);
    expect((await request(app).post('/api/escaneo/diagnostico').send({ resultado: 'OK', ms: 1 })).status).toBe(401);
  });

  it('un archivo del SDK que falta es un 404 (no la app en HTML) y cada descarga queda en el registro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'serena-static-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    mkdirSync(join(dir, 'vendor', 'shenai'), { recursive: true });
    writeFileSync(join(dir, 'vendor', 'shenai', 'index.mjs'), 'export default 1;');
    const { ctx } = makeCtx();
    const app = createApp(ctx, { staticDir: dir });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect((await request(app).get('/vendor/shenai/index.mjs')).status).toBe(200);
    const falta = await request(app).get('/vendor/shenai/shenai_sdk.wasm');
    expect(falta.status).toBe(404);
    expect(falta.headers['content-type']).toMatch(/text\/plain/);
    await new Promise((r) => setTimeout(r, 10));
    const lineas = info.mock.calls.flat().join('\n');
    expect(lineas).toContain('Descarga /vendor/shenai/index.mjs: HTTP 200');
    expect(lineas).toContain('Descarga /vendor/shenai/shenai_sdk.wasm: HTTP 404');
  });
});
