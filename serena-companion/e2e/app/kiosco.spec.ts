import { expect, test } from '@playwright/test';
import { SEED, checkinSinEscaneo, recordErrors } from '../helpers.ts';

// Tablet compartida: registro del kiosco, legajo + PIN, check-in y cierre de la sesión efímera.
test.use({ viewport: { width: 1080, height: 1920 } });

test('kiosco: sesión efímera sin historial', async ({ page }) => {
  const errors = recordErrors(page);
  const pulls: number[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/sync/pull') && r.ok()) pulls.push(((await r.json()) as { cambios: unknown[] }).cambios.length);
  });
  await page.goto('/kiosco');
  await page.getByLabel('CÓDIGO DEL KIOSCO').fill(SEED.kioskToken);
  await page.getByRole('button', { name: 'Registrar este equipo' }).click();
  await page.getByRole('button', { name: 'Legajo + PIN' }).click();
  await page.getByLabel('LEGAJO').fill(SEED.worker.legajo);
  for (const d of SEED.worker.pin) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/kiosco\/checkin$/);
  await checkinSinEscaneo(page, 'Bien');
  await expect(page).toHaveURL(/\/kiosco\/resultado\//);
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByText(/Tu registro ya está/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Cerrar ahora' }).click();
  // El kiosco nunca descarga el historial de la persona (solo lo de su propia sesión).
  expect(Math.max(0, ...pulls)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
