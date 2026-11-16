import { expect, test } from '@playwright/test';

// El módulo de escaneo en marco (apps/web/src/scan/marco): la página existe en la compilación y publica el contrato
// que la app espera. El SDK real no se prueba acá (necesita licencia y cámara).
test('módulo de escaneo en marco: la página publica el contrato', async ({ page }) => {
  const r = await page.goto('/escaneo-marco.html');
  expect(r?.status()).toBe(200);
  const modulo = () => page.evaluate(() => {
    const m = (window as unknown as { serenaEscaneo?: { version: number; crear: unknown } }).serenaEscaneo;
    return m ? { version: m.version, crear: typeof m.crear } : null;
  });
  await expect.poll(modulo).toEqual({ version: 1, crear: 'function' });
  // Sin interfaz: es una página de servicio, no la app.
  await expect(page.locator('#root')).toHaveCount(0);
});
