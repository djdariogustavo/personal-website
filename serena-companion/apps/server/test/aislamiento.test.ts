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
  });

  it('con el SDK: aislamiento de origen, WebAssembly y los orígenes de la licencia en connect-src', async () => {
    const { ctx } = makeCtx();
    const app = createApp(ctx, { aislamientoOrigen: true, escaneoConnectSrc: ['https://licencias.ejemplo.test'] });
    const r = await request(app).get('/api/health');
    expect(r.headers['cross-origin-embedder-policy']).toBe('require-corp');
    expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');
    const csp = r.headers['content-security-policy'];
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/licencias\.ejemplo\.test/);
  });
});
