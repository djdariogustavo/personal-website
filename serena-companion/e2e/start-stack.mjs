// Levanta la app completa para las pruebas de punta a punta: base SQLite temporal con los datos de
// ejemplo (seed), claves efímeras y el servidor sirviendo la web ya compilada (apps/web/dist).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web/dist/index.html');
if (!existsSync(web)) {
  console.error('[e2e] Falta apps/web/dist: corré `npm run build -w @serena/web` antes.');
  process.exit(1);
}
const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: process.env.E2E_PORT ?? '8790',
  SERENA_DB_PATH: join(mkdtempSync(join(tmpdir(), 'serena-e2e-')), 'serena.db'),
  SERENA_MASTER_KEY: randomBytes(32).toString('base64'),
  SERENA_JWT_SECRET: randomBytes(32).toString('base64'),
  SERENA_STATIC_DIR: join(root, 'apps/web/dist'),
  SERENA_PUBLIC_URL: `http://127.0.0.1:${process.env.E2E_PORT ?? '8790'}`,
};
// Nunca se usan servicios reales en las pruebas (IA, SMS, email ni avisos a la guardia), aunque haya
// credenciales o contactos reales en el entorno: un aviso de prueba llegaría al celular de una persona.
const REALES = ['TWILIO_', 'ANTHROPIC_', 'RESEND_', 'SERENA_ALERTAS_', 'SERENA_GUARDIA_', 'SHENAI_ADMIN'];
for (const k of Object.keys(env)) if (REALES.some((p) => k.startsWith(p)) || k === 'SERENA_SMS' || k === 'SERENA_GUARD_WEBHOOK_URL') delete env[k];

const tsx = join(root, 'node_modules/.bin/tsx');
const seed = spawnSync(tsx, ['apps/server/src/seed.ts'], { cwd: root, env, stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const server = spawn(tsx, ['apps/server/src/index.ts'], { cwd: root, env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
