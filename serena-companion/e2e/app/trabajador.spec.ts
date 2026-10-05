import { expect, test, devices } from '@playwright/test';
import { SEED, checkinSinEscaneo, gotoMobile, login, logout, onboarding, recordErrors } from '../helpers.ts';

// Teléfono: ingreso con 2FA y PIN local, pedido de ayuda, check-in, acompañante y cierre de sesión.
test.use({ ...devices['Pixel 7'], permissions: ['geolocation'], geolocation: { latitude: -31.5, longitude: -68.5 } });

test('trabajador en el teléfono: ingreso, ayuda, check-in y acompañante', async ({ page }) => {
  const errors = recordErrors(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/bienvenida$/);
  await onboarding(page);
  await login(page, SEED.worker.dni, SEED.worker.password);

  // En el teléfono se crea un PIN de desbloqueo local (dos veces).
  await expect(page.getByText('Creá un PIN')).toBeVisible();
  for (const d of '12341234') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hacer mi check-in' }).first()).toBeVisible();

  // Pedido de ayuda: deslizar para enviar (con teclado, como lector de pantalla).
  await page.getByRole('button', { name: 'Ayuda' }).click();
  await page.getByRole('button', { name: /Emergencia física/ }).click();
  await page.getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(page.getByText(/Aviso enviado a la guardia/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Volver' }).click();

  // Check-in: el nivel lo recalcula el servidor.
  await page.getByRole('button', { name: 'Hacer mi check-in' }).first().click();
  await checkinSinEscaneo(page, 'Cansado');
  await expect(page).toHaveURL(/\/resultado\//);

  // Acompañante: una frase de riesgo activa el modo cuidado.
  await gotoMobile(page, '/acompanante');
  // Recargar bloquea con el PIN: la app no queda abierta si alguien toma el teléfono.
  await page.getByLabel('Mensaje').fill('A veces pienso que no quiero seguir.');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText(/merece ayuda de una persona ahora/)).toBeVisible();

  await gotoMobile(page, '/privacidad');
  await expect(page.getByRole('heading', { name: 'Privacidad y datos' })).toBeVisible();
  await logout(page);
  expect(errors).toEqual([]);
});
