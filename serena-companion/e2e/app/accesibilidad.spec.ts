import { expect, test, devices, type Page } from '@playwright/test';
import { SEED, gotoMobile, login, onboarding } from '../helpers.ts';
import { auditar, informar, type Hallazgo } from '../a11y.ts';

/**
 * Accesibilidad automática (axe-core, WCAG 2.2 A/AA) de todas las pantallas, en los dos temas
 * ("noche" y "sol", el de alto contraste para exteriores). La revisión manual está en
 * docs/ACCESIBILIDAD.md: axe no puede juzgar todo (orden de lectura, sentido de los textos, etc.).
 */

const RUTAS_TRABAJADOR = [
  ['Hoy', '/'],
  ['Respiración guiada', '/respirar'],
  ['Acompañante', '/acompanante'],
  ['Mi bienestar', '/bienestar'],
  ['Recursos', '/recursos'],
  ['Recurso', '/recursos/dormir-turno-noche'],
  ['Privacidad', '/privacidad'],
  ['Dispositivos', '/dispositivos'],
  ['Cambiar contraseña', '/contrasena'],
] as const;

async function tema(page: Page, t: 'noche' | 'sol') {
  await page.evaluate((v) => localStorage.setItem('serena.theme', JSON.stringify(v)), t);
}

for (const t of ['noche', 'sol'] as const) {
  test.describe(`tema ${t}`, () => {
    test('público: bienvenida, consentimiento, ingreso, 2FA y recuperación', async ({ page }, info) => {
      const h: Hallazgo[] = [];
      await page.goto('/');
      await tema(page, t);
      await page.goto('/bienvenida');
      await auditar(page, 'Bienvenida', h);
      await page.getByRole('button', { name: 'Empezar', exact: true }).click();
      await auditar(page, 'Presentación', h);
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
      await auditar(page, 'Consentimiento', h);
      await page.getByRole('button', { name: 'Acepto y continúo' }).click();
      await auditar(page, 'Ingreso', h);
      await page.getByLabel('USUARIO CORPORATIVO O DNI').fill('nadie');
      await page.getByLabel('CONTRASEÑA').fill('x');
      await page.getByRole('button', { name: 'Ingresar' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await auditar(page, 'Ingreso con error', h);
      await page.goto('/recuperar');
      await auditar(page, 'Recuperar contraseña', h);
      await page.goto('/privacidad/politica');
      await auditar(page, 'Política de privacidad', h);
      await informar(h, info);
      expect(h).toEqual([]);
    });

    test('trabajador en el teléfono', async ({ browser }, info) => {
      const ctx = await browser.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'], geolocation: { latitude: -31.5, longitude: -68.5 } });
      const page = await ctx.newPage();
      const h: Hallazgo[] = [];
      await page.goto('/');
      await tema(page, t);
      await page.goto('/bienvenida');
      await onboarding(page);
      await login(page, SEED.worker.usuario, SEED.worker.password);
      await expect(page.getByText('Creá un PIN')).toBeVisible();
      await auditar(page, 'Crear PIN', h);
      for (const d of '12341234') await page.getByRole('button', { name: d, exact: true }).click();
      await expect(page.getByRole('button', { name: 'Hacer mi check-in' }).first()).toBeVisible();
      for (const [nombre, ruta] of RUTAS_TRABAJADOR) {
        await gotoMobile(page, ruta);
        await auditar(page, nombre, h);
      }
      // Bloqueo con PIN (al recargar).
      await page.goto('/');
      await expect(page.getByRole('dialog', { name: 'Desbloquear' })).toBeVisible();
      await auditar(page, 'Desbloqueo con PIN', h);
      await gotoMobile(page, '/');
      // Hoja de ayuda.
      await page.getByRole('button', { name: 'Ayuda' }).click();
      await auditar(page, 'Ayuda (elegir)', h);
      await page.getByRole('button', { name: /Necesito hablar/ }).click();
      await auditar(page, 'Ayuda (deslizar)', h);
      await page.getByRole('button', { name: 'Cerrar' }).click();
      // Check-in.
      await page.getByRole('button', { name: 'Hacer mi check-in' }).first().click();
      await auditar(page, 'Check-in: ánimo', h);
      await page.getByRole('radio', { name: 'Bien', exact: true }).click();
      await page.getByRole('button', { name: 'Siguiente' }).click();
      await page.getByRole('button', { name: 'Prefiero saltear el escaneo' }).waitFor();
      await auditar(page, 'Check-in: luz y cámara', h);
      await page.getByRole('button', { name: 'Prefiero saltear el escaneo' }).click();
      if (await page.getByText('Dos pruebas cortas').isVisible({ timeout: 2000 }).catch(() => false)) {
        await auditar(page, 'Check-in: pruebas', h);
        await page.getByRole('button', { name: 'Empezar', exact: true }).click();
        for (let i = 0; i < 10; i++) {
          const dot = page.getByRole('button', { name: 'Círculo' });
          await dot.waitFor();
          if (i === 0) await auditar(page, 'Check-in: reacción', h);
          await dot.dispatchEvent('pointerdown');
        }
        await page.getByRole('button', { name: 'Ver mi resultado' }).click();
      }
      await expect(page).toHaveURL(/\/resultado\//);
      await auditar(page, 'Resultado', h);
      await informar(h, info);
      expect(h).toEqual([]);
      await ctx.close();
    });

    test('escritorio, kiosco y panel de la empresa', async ({ browser }, info) => {
      const h: Hallazgo[] = [];
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      await page.goto('/');
      await tema(page, t);
      await page.goto('/ingresar');
      if (!(await page.getByLabel('USUARIO CORPORATIVO O DNI').isVisible().catch(() => false))) await onboarding(page);
      await login(page, SEED.admin.usuario, SEED.admin.password);
      await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
      await auditar(page, 'Empresa: reportes sin suscripción', h);
      await page.getByRole('link', { name: 'Equipo y kioscos' }).click();
      await expect(page.getByRole('heading', { name: 'Equipo y kioscos' })).toBeVisible();
      await auditar(page, 'Empresa: equipo', h);
      await page.getByRole('link', { name: 'Facturación' }).click();
      await expect(page.getByRole('heading', { name: 'Facturación' })).toBeVisible();
      await auditar(page, 'Empresa: facturación', h);
      await page.getByRole('button', { name: 'Continuar al pago' }).click();
      await auditar(page, 'Empresa: pago de prueba', h);

      const k = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
      await k.goto('/kiosco');
      await tema(k, t);
      await k.reload();
      await auditar(k, 'Kiosco: registro', h);
      await k.getByLabel('CÓDIGO DEL KIOSCO').fill(SEED.kioskToken);
      await k.getByRole('button', { name: 'Registrar este equipo' }).click();
      await auditar(k, 'Kiosco: espera', h);
      await k.getByRole('button', { name: 'Legajo + PIN' }).click();
      await auditar(k, 'Kiosco: identificación', h);
      await informar(h, info);
      expect(h).toEqual([]);
    });
  });
}
