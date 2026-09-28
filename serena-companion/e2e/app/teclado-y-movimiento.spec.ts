import { expect, test, devices } from '@playwright/test';
import { SEED, gotoMobile, login, onboarding } from '../helpers.ts';

/**
 * Criterios WCAG 2.2 que axe no puede verificar solo: operación con teclado (2.1.1), alternativa al
 * arrastre (2.5.7), saltar bloques (2.4.1), títulos (2.4.2), reflujo a 320 px (1.4.10), tiempo
 * ajustable (2.2.1) y animaciones con movimiento reducido (2.3.3).
 */

test('teclado: saltar al contenido, títulos y prueba de reacción sin mouse', async ({ page }) => {
  await page.goto('/ingresar');
  if (!(await page.getByLabel('USUARIO CORPORATIVO O DNI').isVisible().catch(() => false))) await onboarding(page);
  await login(page, SEED.worker.usuario, SEED.worker.password);
  await expect(page.getByRole('button', { name: 'Hacer mi check-in' }).first()).toBeVisible();

  // El primer Tab muestra "Saltar al contenido" y lleva el foco al contenido principal.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Saltar al contenido' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();

  // Cada pantalla tiene su título.
  await expect(page).toHaveTitle(/· SERENA Companion$/);
  await page.getByRole('link', { name: 'Mi bienestar' }).first().click();
  await expect(page).toHaveTitle('Mi bienestar · SERENA Companion');
  await expect(page.locator('main#main')).toBeFocused(); // el foco pasa a la pantalla nueva

  // Gráfico: un solo foco que se recorre con las flechas.
  await page.getByRole('group', { name: /Gráfico de/ }).focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.chart [aria-live="polite"]')).not.toHaveText('');

  // Check-in completo con teclado, incluida la prueba de reacción (con la cámara apagada se va directo a ella).
  const consents = (on: boolean) =>
    page.evaluate(async (camara) => {
      const s = JSON.parse(localStorage.getItem('serena.session')!);
      const h = { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' };
      const me = await (await fetch('/api/me', { headers: h })).json();
      await fetch('/api/consents', { method: 'PUT', headers: h, body: JSON.stringify({ ...me.perfil.consents, camara }) });
    }, on);
  await consents(false);
  await page.goto('/');
  await page.getByRole('button', { name: 'Hacer mi check-in' }).first().waitFor();
  await page.getByRole('button', { name: 'Hacer mi check-in' }).first().click();
  await page.getByRole('radio', { name: 'Bien', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Siguiente' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Dos pruebas cortas')).toBeVisible();
  await page.getByRole('button', { name: 'Empezar', exact: true }).focus();
  await page.keyboard.press('Enter');
  const ahora = page.locator('[aria-live="assertive"]', { hasText: 'Ahora' });
  for (let i = 0; i < 10; i++) {
    await expect(ahora).toBeAttached({ timeout: 5000 });
    await page.keyboard.press('Space');
    await expect(ahora).toHaveCount(0);
  }
  await expect(page.getByText('Tiempo medio de reacción')).toBeVisible();
  await consents(true);
});

test('pedido de ayuda sin deslizar: dos toques en botones distintos', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto('/');
  await onboarding(page);
  await login(page, SEED.worker.dni, SEED.worker.password);
  for (const d of '12341234') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hacer mi check-in' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Ayuda' }).click();
  await page.getByRole('button', { name: /Necesito hablar/ }).click();
  await page.getByRole('button', { name: '¿No podés deslizar? Enviar con dos toques' }).click();
  await expect(page.getByText(/Aviso enviado/)).toHaveCount(0); // un toque no envía
  await page.getByRole('button', { name: 'Confirmar: enviar el aviso' }).click();
  await expect(page.getByText(/Aviso enviado a la guardia/)).toBeVisible({ timeout: 15_000 });

  // Reflujo a 320 px de ancho: sin desplazamiento horizontal.
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  for (const ruta of ['/', '/bienestar', '/privacidad', '/acompanante', '/recursos']) {
    await gotoMobile(page, ruta);
    const desborde = await page.evaluate(() => {
      const main = document.querySelector('main');
      return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main ? main.scrollWidth - main.clientWidth : 0);
    });
    expect(desborde, ruta).toBeLessThanOrEqual(1);
  }
  await ctx.close();
});

test('inactividad: se avisa un minuto antes y se puede seguir', async ({ page }) => {
  await page.clock.install();
  await page.goto('/ingresar');
  if (!(await page.getByLabel('USUARIO CORPORATIVO O DNI').isVisible().catch(() => false))) await onboarding(page);
  await login(page, SEED.worker.usuario, SEED.worker.password);
  await expect(page.getByRole('button', { name: 'Hacer mi check-in' }).first()).toBeVisible();
  // Escritorio: 15 minutos.
  await page.clock.fastForward('14:01');
  const aviso = page.getByRole('alertdialog', { name: '¿Seguís ahí?' });
  await expect(aviso).toBeVisible();
  await expect(aviso.getByRole('button', { name: 'Sigo acá' })).toBeFocused();
  await aviso.getByRole('button', { name: 'Sigo acá' }).click();
  await expect(aviso).toHaveCount(0);
  await page.clock.fastForward('14:30');
  await expect(page.getByText('Cerramos tu sesión por inactividad.')).toHaveCount(0); // se reinició el plazo
  await page.clock.fastForward('01:00');
  await expect(page.getByText('Cerramos tu sesión por inactividad.')).toBeVisible();
});

test('movimiento reducido: la respiración guiada no anima pero sigue guiando', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/ingresar');
  if (!(await page.getByLabel('USUARIO CORPORATIVO O DNI').isVisible().catch(() => false))) await onboarding(page);
  await login(page, SEED.worker.usuario, SEED.worker.password);
  await page.getByRole('button', { name: 'Hacer mi check-in' }).first().waitFor();
  await page.goto('/respirar');
  await expect(page.getByText(/Inhalá|Exhalá/).first()).toBeVisible();
  const duraciones = await page.evaluate(() =>
    [...document.querySelectorAll('*')].map((e) => getComputedStyle(e).animationDuration).filter((d) => d !== '0s' && d !== '1e-05s' && d !== '0.00001s'),
  );
  expect(duraciones).toEqual([]);
  await ctx.close();
});
