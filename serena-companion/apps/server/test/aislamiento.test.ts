import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { makeCtx } from './helpers.ts';

describe('cabeceras para el SDK de escaneo', () => {
  it('sin el SDK no se envía COEP ni se habilita WebAssembly en la CSP', async () => {
    const { ctx } = makeCtx();
    const r = await request(createApp(ctx)).get('/api/health');
    expect(r.headers['cross-origin-embedder-policy']).toBeUndefined();
    expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(r.headers['content-security-policy']).not.toMatch(/wasm-unsafe-eval/);
    expect(r.headers['content-security-policy']).not.toMatch(/'unsafe-eval'/);
  });

  it('con solo los indicadores oculares: WebAssembly sí, eval de JavaScript no', async () => {
    const { ctx } = makeCtx();
    ctx.config = { ...ctx.config, ocular: { ...ctx.config.ocular, habilitado: true } };
    const csp = (await request(createApp(ctx)).get('/api/health')).headers['content-security-policy'];
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'/);
    expect(csp).not.toMatch(/'unsafe-eval'/);
  });

  it('con el SDK: aislamiento de origen, WebAssembly y los orígenes de la licencia en connect-src', async () => {
    const { ctx } = makeCtx();
    const app = createApp(ctx, { aislamientoOrigen: true, escaneoConnectSrc: ['https://licencias.ejemplo.test'] });
    const r = await request(app).get('/api/health');
    expect(r.headers['cross-origin-embedder-policy']).toBe('require-corp');
    // El proveedor exige también Cross-Origin-Resource-Policy: same-origin (developer.shen.ai, System requirements).
    expect(r.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');
    const csp = r.headers['content-security-policy'];
    // 'unsafe-eval' solo con el SDK: lo exige su código generado (embind). Ver docs/PENDIENTES.md.
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/licencias\.ejemplo\.test/);
  });

  it('con el SDK en un marco: unsafe-eval solo en la página del módulo y en los archivos del SDK, no en la app', async () => {
    const { ctx } = makeCtx();
    const staticDir = mkdtempSync(join(tmpdir(), 'serena-marco-'));
    mkdirSync(join(staticDir, 'vendor/shenai'), { recursive: true });
    for (const f of ['index.html', 'escaneo-marco.html', 'vendor/shenai/shenai_sdk.mjs']) writeFileSync(join(staticDir, f), '');
    const app = createApp(ctx, { aislamientoOrigen: true, escaneoMarco: true, staticDir });
    const csp = async (ruta: string) => (await request(app).get(ruta)).headers['content-security-policy'] as string;
    for (const ruta of ['/api/health', '/', '/checkin']) {
      expect(await csp(ruta)).toMatch(/script-src 'self' 'wasm-unsafe-eval';/);
      expect(await csp(ruta)).not.toMatch(/'unsafe-eval'/);
    }
    // La política de un worker es la de su propio archivo: los del SDK se cargan desde /vendor/shenai.
    for (const ruta of ['/escaneo-marco.html', '/vendor/shenai/shenai_sdk.mjs']) expect(await csp(ruta)).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'/);
    // El aislamiento de origen vale para todas: el marco lo necesita igual que la app.
    for (const ruta of ['/api/health', '/escaneo-marco.html']) expect((await request(app).get(ruta)).headers['cross-origin-embedder-policy']).toBe('require-corp');
  });
});
