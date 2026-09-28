import { expect, test, type Browser, type Page } from '@playwright/test';
import { SEED, login, onboarding, recordErrors } from '../helpers.ts';

/**
 * Ciclo de vida de una persona desde el panel de la empresa, en orden:
 * alta → contraseña inicial obligatoria → recuperación por SMS → restablecimiento
 * por la empresa → baja → la persona elimina su cuenta. Y contratación + reportes.
 * Usa su propia persona (no la del seed) para no afectar a las otras pruebas.
 */
test.describe.configure({ mode: 'serial' });

const PERSONA = { nombre: 'Ana Prueba Pérez', corto: 'Ana', dni: '28.000.111', legajo: '900', telefono: '+54 9 264 555 0900' };
let passwordInicial = '';
let password = 'mate cocido en la garita';
let temporal = '';

async function nuevaPagina(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/ingresar');
  if (!(await page.getByLabel('USUARIO CORPORATIVO O DNI').isVisible().catch(() => false))) await onboarding(page);
  return page;
}

async function comoAdmin(browser: Browser): Promise<Page> {
  const page = await nuevaPagina(browser);
  await login(page, SEED.admin.usuario, SEED.admin.password);
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  return page;
}

async function filaDe(page: Page) {
  await page.getByRole('link', { name: 'Equipo y kioscos' }).click();
  const fila = page.locator('.list-row', { hasText: PERSONA.nombre });
  await expect(fila).toBeVisible();
  return fila;
}

test('alta: se entregan credenciales que se muestran una sola vez', async ({ browser }) => {
  const page = await comoAdmin(browser);
  const errors = recordErrors(page);
  await page.getByRole('link', { name: 'Equipo y kioscos' }).click();
  const alta = page.locator('section', { hasText: 'ALTA DE UNA PERSONA' });
  await alta.getByLabel('NOMBRE Y APELLIDO').fill(PERSONA.nombre);
  await alta.getByLabel('CÓMO LE DECIMOS').fill(PERSONA.corto);
  await alta.getByLabel('DNI').fill(PERSONA.dni);
  await alta.getByLabel('LEGAJO').fill(PERSONA.legajo);
  await alta.getByLabel('TELÉFONO (2FA)').fill(PERSONA.telefono);
  await alta.getByRole('button', { name: 'Dar de alta' }).click();
  const fila = page.locator('tr', { hasText: 'passwordInicial' });
  await expect(fila).toBeVisible();
  passwordInicial = (await fila.locator('td').nth(1).textContent())!.trim();
  expect(passwordInicial.length).toBeGreaterThan(8);
  await expect(page.locator('.list-row', { hasText: PERSONA.nombre })).toBeVisible();
  expect(errors).toEqual([]);
});

test('la contraseña inicial obliga a elegir una propia; mientras tanto la Ayuda sigue disponible', async ({ browser }) => {
  const page = await nuevaPagina(browser);
  await login(page, PERSONA.dni, passwordInicial);
  await expect(page.getByRole('heading', { name: 'Elegí tu contraseña' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ayuda' })).toBeVisible();
  await page.getByLabel('CONTRASEÑA TEMPORAL').fill(passwordInicial);
  await page.getByLabel('CONTRASEÑA NUEVA').fill('Ana Prueba 2026');
  await expect(page.locator('#pw-ayuda')).toHaveText(/No uses tu DNI, legajo, usuario ni tu nombre/);
  await page.getByLabel('CONTRASEÑA NUEVA').fill(password);
  await page.getByLabel('REPETILA').fill(password);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByRole('button', { name: 'Hacer mi check-in' }).first()).toBeVisible();
});

test('recuperación por SMS', async ({ browser }) => {
  const page = await nuevaPagina(browser);
  await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
  await expect(page.getByRole('heading', { name: 'Recuperá tu contraseña' })).toBeVisible();
  await page.getByLabel('USUARIO CORPORATIVO O DNI').fill(PERSONA.dni);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  const pista = page.getByText(/Modo desarrollo/);
  await expect(pista).toBeVisible();
  const code = (await pista.textContent())!.match(/(\d{6})/)![1]!;
  password = 'otra frase para el turno noche';
  await page.getByLabel('CÓDIGO DEL SMS').fill(code);
  await page.getByLabel('CONTRASEÑA NUEVA').fill(password);
  await page.getByLabel('REPETILA').fill(password);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Listo, ya podés ingresar')).toBeVisible();
  await page.getByRole('button', { name: 'Ir al ingreso' }).click();
  await login(page, PERSONA.dni, password);
  await expect(page.getByRole('button', { name: 'Hacer mi check-in' }).first()).toBeVisible();
});

test('restablecimiento por la empresa: la temporal vuelve a exigir una propia', async ({ browser }) => {
  const admin = await comoAdmin(browser);
  const fila = await filaDe(admin);
  await fila.getByRole('button', { name: 'Restablecer contraseña' }).click();
  await admin.getByRole('button', { name: 'Sí, restablecer' }).click();
  temporal = (await admin.locator('tr', { hasText: 'passwordTemporal' }).locator('td').nth(1).textContent())!.trim();

  const page = await nuevaPagina(browser);
  // La contraseña anterior ya no sirve.
  await page.getByLabel('USUARIO CORPORATIVO O DNI').fill(PERSONA.dni);
  await page.getByLabel('CONTRASEÑA').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toHaveText(/no coinciden/);
  await login(page, PERSONA.dni, temporal);
  await expect(page.getByRole('heading', { name: 'Elegí tu contraseña' })).toBeVisible();
});

test('baja: la persona solo puede ver o eliminar sus datos', async ({ browser }) => {
  const admin = await comoAdmin(browser);
  const fila = await filaDe(admin);
  await fila.getByRole('button', { name: 'Dar de baja' }).click();
  await admin.getByRole('button', { name: 'Sí, dar de baja' }).click();
  await expect(admin.getByText(`Se dio de baja a ${PERSONA.nombre}`)).toBeVisible();
  await expect(fila.getByText('DE BAJA')).toBeVisible();

  // Con la temporal pendiente, la cuenta de baja igual puede ver y eliminar sus datos.
  const page = await nuevaPagina(browser);
  await login(page, PERSONA.dni, temporal);
  await expect(page.getByRole('heading', { name: 'Tu cuenta fue dada de baja' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ayuda' })).toHaveCount(0);
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar mis datos' }).click();
  expect((await descarga).suggestedFilename()).toMatch(/^serena-mis-datos-.*\.json$/);
  await page.getByRole('button', { name: 'Eliminar mi cuenta ahora' }).click();
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.getByText('Eliminamos tu cuenta.')).toBeVisible();

  await admin.reload();
  await admin.getByRole('link', { name: 'Equipo y kioscos' }).click();
  await expect(admin.locator('.list-row', { hasText: PERSONA.nombre })).toHaveCount(0);
});

test('contratación de prueba y reportes anónimos', async ({ browser }) => {
  const page = await comoAdmin(browser);
  const errors = recordErrors(page);
  await expect(page.getByText('Los reportes requieren una suscripción activa.')).toBeVisible();
  await page.getByRole('button', { name: 'Ir a Facturación' }).click();
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await page.getByRole('button', { name: 'Aprobar pago de prueba' }).click();
  await expect(page.getByText('ACTIVA', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Reportes' }).click();
  await expect(page.getByText('DISTRIBUCIÓN DE NIVELES POR DÍA DE ROSTER · EN TURNO')).toBeVisible();
  await expect(page.getByText(/Período: .* se actualiza cada lunes/)).toBeVisible();
  // Nunca aparece un nombre en los reportes.
  await expect(page.getByText(/Matías|Rodríguez/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
