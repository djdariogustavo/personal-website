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
});
