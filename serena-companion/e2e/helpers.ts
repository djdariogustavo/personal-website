import { expect, type Page } from '@playwright/test';

/** Datos del seed (apps/server/src/seed.ts). */
export const SEED = {
  worker: { usuario: 'mrodriguez', dni: '30.456.789', password: 'serena-demo', legajo: '04817', pin: '1234' },
  admin: { usuario: 'admin', password: 'serena-admin' },
  kioskToken: 'kiosco-demo-comedor-modulo-3-token-no-usar-en-produccion',
};

/** Usuario + contraseña y el código 2FA que el servidor devuelve en modo desarrollo. */
export async function login(page: Page, identificador: string, password: string) {
  await page.getByLabel('USUARIO CORPORATIVO O DNI').fill(identificador);
  await page.getByLabel('CONTRASEÑA').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  const pista = page.getByText(/Modo desarrollo/);
  await expect(pista).toBeVisible();
  const code = (await pista.textContent())!.match(/(\d{6})/)![1]!;
  await page.getByLabel('Dígito 1').fill(code);
}

/** Bienvenida → consentimiento → ingreso (primera vez en el dispositivo). */
export async function onboarding(page: Page) {
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Acepto y continúo' }).click();
  await expect(page.getByLabel('USUARIO CORPORATIVO O DNI')).toBeVisible();
}

/** En el teléfono, recargar la página bloquea la app con el PIN local: se desbloquea si hace falta. */
export async function gotoMobile(page: Page, path: string, pin = '1234') {
  await page.goto(path);
  const lock = page.getByRole('dialog', { name: 'Desbloquear' });
  if (await lock.isVisible({ timeout: 3000 }).catch(() => false)) {
    for (const d of pin) await lock.getByRole('button', { name: d, exact: true }).click();
    await expect(lock).toHaveCount(0);
  }
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Menú de la cuenta' }).click();
  await page.getByRole('menuitem', { name: /Cerrar sesión/ }).click();
  const igual = page.getByRole('button', { name: 'Cerrar sesión igual' });
  if (await igual.isVisible().catch(() => false)) await igual.click();
  await expect(page.getByLabel('USUARIO CORPORATIVO O DNI')).toBeVisible();
}

/** Check-in sin escaneo: ánimo, (sueño), saltear escaneo y, si aparece, la prueba de reacción. */
export async function checkinSinEscaneo(page: Page, animo: string) {
  await page.getByRole('radio', { name: animo, exact: true }).click();
  const sueno = page.getByRole('radio', { name: '4 a 6 h' });
  if (await sueno.isVisible().catch(() => false)) await sueno.click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Prefiero saltear el escaneo' }).click();
  if (await page.getByText('Dos pruebas cortas').isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.getByRole('button', { name: 'Empezar', exact: true }).click();
    for (let i = 0; i < 10; i++) {
      const dot = page.getByRole('button', { name: 'Círculo' });
      await dot.waitFor();
      await dot.dispatchEvent('pointerdown');
    }
    await page.getByRole('button', { name: 'Ver mi resultado' }).click();
  }
}

/** Errores de la página (excepciones sin atrapar). Las respuestas 4xx esperadas no cuentan. */
export function recordErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
