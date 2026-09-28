import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de punta a punta.
 * - "app": la app real (servidor + web compilada) sobre una base temporal sembrada en cada corrida.
 * - "demo": la vista previa estática (API simulada en el navegador) que se comparte para revisión.
 *
 * Requiere las compilaciones previas: `npm run e2e` las hace; en CI se hacen en pasos anteriores.
 * Las pruebas de "app" comparten una base, por eso corren en serie y cada una usa sus propios datos.
 */
const APP = 'http://127.0.0.1:8790';
const DEMO = 'http://127.0.0.1:8791';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'report' }]] : 'list',
  outputDir: 'results',
  use: {
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'app', testMatch: 'app/*.spec.ts', use: { ...devices['Desktop Chrome'], baseURL: APP } },
    { name: 'demo', testMatch: 'demo/*.spec.ts', use: { ...devices['Desktop Chrome'], baseURL: DEMO } },
  ],
  webServer: [
    { command: 'node e2e/start-stack.mjs', url: `${APP}/api/health`, cwd: '..', reuseExistingServer: false, timeout: 60_000, stdout: 'ignore', stderr: 'pipe' },
    { command: 'node e2e/serve-static.mjs apps/web/dist-demo 8791', url: DEMO, cwd: '..', reuseExistingServer: false, timeout: 20_000 },
  ],
});
