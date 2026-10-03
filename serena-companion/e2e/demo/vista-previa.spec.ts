import { expect, test } from '@playwright/test';
import { login, onboarding, recordErrors } from '../helpers.ts';

// Vista previa estática (API simulada en el navegador): la que se comparte para revisión.
test.use({ viewport: { width: 1440, height: 1000 } });

test('vista previa: recorrido del trabajador y del panel de la empresa', async ({ page }) => {
  const errors = recordErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Empezar el recorrido' }).click();

  // Teléfono: ingreso con PIN local y check-in con la luz simulada.
  await onboarding(page);
  await login(page, 'mrodriguez', 'serena-demo');
  await expect(page.getByText('Creá un PIN')).toBeVisible();
  for (const d of '12341234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Hacer mi check-in' }).first().click();
  await page.getByRole('radio', { name: 'Cansado', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByText('VISTA PREVIA · SIMULÁ')).toBeVisible();
  await page.getByRole('button', { name: 'Insuficiente' }).click();
  await expect(page.getByRole('button', { name: 'Empezar escaneo' })).toBeDisabled();
  await page.getByRole('button', { name: 'Óptima' }).click();
  await expect(page.getByRole('button', { name: 'Empezar escaneo' })).toBeEnabled();

  // Escritorio + empresa: el primer clic apenas se ingresa debe navegar (regresión corregida en A8).
  await page.getByRole('radio', { name: 'Escritorio' }).click();
  await page.getByRole('button', { name: 'Menú de la cuenta' }).click();
  await page.getByRole('menuitem', { name: /Cerrar sesión/ }).click();
  const igual = page.getByRole('button', { name: 'Cerrar sesión igual' });
  if (await igual.isVisible().catch(() => false)) await igual.click();
  await login(page, 'admin', 'serena-admin');
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  await page.getByRole('link', { name: 'Equipo y kioscos' }).click();
  await expect(page.getByRole('heading', { name: 'Equipo y kioscos' })).toBeVisible();
  await expect(page.locator('.list-row', { hasText: 'Matías Rodríguez' })).toBeVisible();

  await page.getByRole('link', { name: 'Facturación' }).click();
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await page.getByRole('button', { name: 'Aprobar pago de prueba' }).click();
  await expect(page.getByText('ACTIVA', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Reportes' }).click();
  await expect(page.getByText(/Moderado o alto \(agrupados por ser pocos\)/)).toBeVisible();
  await expect(page.getByText(/todo el grupo en el mismo rango/)).toBeVisible();
  expect(errors).toEqual([]);
});
