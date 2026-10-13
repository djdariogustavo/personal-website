import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isOffline, OfflineError } from '../src/lib/api.ts';

const respuesta = (status: number, cuerpo: unknown, tipo = 'application/json') =>
  new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers: { 'content-type': tipo } });

async function error(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('se esperaba un error');
}

describe('cliente de la API: sin conexión frente a error del servidor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('"sin conexión" solo cuando el pedido no llega (fetch falla por red)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const e = await error(api('/admin/billing/checkout', { body: {} }));
    expect(isOffline(e)).toBe(true);
    expect((e as OfflineError).motivo).toBe('red');
  });

  it('un 502 con la respuesta de SERENA muestra su mensaje, no "sin conexión"', async () => {
    const mensaje = 'No pudimos iniciar el pago con Mercado Pago. Probá de nuevo o contactanos.';
    vi.stubGlobal('fetch', async () => respuesta(502, { error: 'proveedor_pago', mensaje }));
    const e = await error(api('/admin/billing/checkout', { body: {} }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 502, code: 'proveedor_pago', mensaje });
  });

  it('un 502/503/504 del proxy, sin respuesta de SERENA, se reintenta como sin conexión pero indica que fue el servidor', async () => {
    for (const status of [502, 503, 504]) {
      vi.stubGlobal('fetch', async () => respuesta(status, '<html>Bad Gateway</html>', 'text/html'));
      const e = await error(api('/sync/push', { body: {} }));
      expect(isOffline(e)).toBe(true);
      expect((e as OfflineError).motivo).toBe('servidor');
    }
  });

  it('un error 400 del servidor llega con su código y mensaje', async () => {
    const mensaje = 'El email de la cuenta que paga no puede ser el de la cuenta que cobra. Usá el email de otra cuenta de Mercado Pago.';
    vi.stubGlobal('fetch', async () => respuesta(400, { error: 'pagador_igual_cobrador', mensaje }));
    expect(await error(api('/admin/billing/checkout', { body: {} }))).toMatchObject({ status: 400, code: 'pagador_igual_cobrador', mensaje });
  });
});
