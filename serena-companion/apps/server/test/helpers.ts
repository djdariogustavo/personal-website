import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { DEFAULT_CONFIG } from '@serena/domain';
import { openDb } from '../src/db.ts';
import { hashSecret, newId, sha256, Vault } from '../src/crypto.ts';
import { createApp } from '../src/app.ts';
import { buildRegistry } from '../src/payments/index.ts';
import { BasicCompanion } from '../src/companion.ts';
import { ConsoleGuardNotifier, type Messenger } from '../src/notify.ts';
import type { AppContext } from '../src/context.ts';

export class CapturingMessenger implements Messenger {
  last: string | null = null;
  async sendOtp(_to: unknown, code: string) {
    this.last = code;
  }
}

export function makeCtx() {
  const messenger = new CapturingMessenger();
  const guard = new ConsoleGuardNotifier();
  guard.notify = async function (alert) {
    this.sent.push(alert);
    return { entregado: true };
  };
  const ctx: AppContext = {
    db: openDb(':memory:'),
    vault: new Vault(randomBytes(32).toString('base64')),
    jwtKey: new TextEncoder().encode('test-secret-test-secret-test-sec'),
    publicUrl: 'http://localhost:5173',
    exposeDevOtp: false,
    config: DEFAULT_CONFIG,
    payments: buildRegistry({
      stripe: { secretKey: null, webhookSecret: null, priceIds: {} },
      mercadopago: { accessToken: null, webhookSecret: null, currency: 'ARS' },
      sandbox: true,
      sandboxSecret: 'sandbox-secret',
      publicUrl: 'http://localhost:5173',
    }),
    companion: new BasicCompanion(),
    messenger,
    guard,
  };
  const orgId = newId();
  ctx.db.prepare("INSERT INTO orgs (id, nombre, faena, pais, creado_en) VALUES (?, 'Org', 'Mina Test', 'AR', ?)").run(orgId, new Date().toISOString());
  const app = createApp(ctx);
  return { ctx, app, orgId, messenger, guard };
}

export function addUser(ctx: AppContext, orgId: string, o: { role?: 'worker' | 'admin'; dni: string; usuario?: string; legajo: string; password: string; pin?: string; qr?: string }) {
  const id = newId();
  const today = new Date();
  const start = new Date(today.getTime() - 8 * 86_400_000);
  const ymd = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  ctx.db
    .prepare(
      `INSERT INTO users (id, org_id, role, nombre, nombre_corto, dni, usuario, legajo, telefono, email, password_hash, kiosk_pin_hash, qr_token_hash, roster_inicio, creado_en)
       VALUES (?, ?, ?, 'Persona Test', 'Persona', ?, ?, ?, '+5400000047', 'a@example.com', ?, ?, ?, ?, ?)`,
    )
    .run(id, orgId, o.role ?? 'worker', o.dni, o.usuario ?? null, o.legajo, hashSecret(o.password), o.pin ? hashSecret(o.pin) : null, o.qr ? sha256(o.qr) : null, ymd, new Date().toISOString());
  ctx.db.prepare('INSERT INTO consents (user_id, camara, animo, reaccion, chat, geo, otorgado, actualizado_en) VALUES (?, 1, 1, 1, 1, 1, 1, ?)').run(id, new Date().toISOString());
  return id;
}

export const device = (kind = 'mobile', id?: string) => ({ kind, nombre: `Dispositivo ${kind}`, sistema: 'Test', ...(id ? { id } : {}) });

export async function login(app: ReturnType<typeof createApp>, messenger: CapturingMessenger, identificador: string, password: string, kind = 'mobile') {
  const r1 = await request(app).post('/api/auth/login').send({ identificador, password, device: device(kind) });
  if (r1.body.paso !== 'segundo_factor') throw new Error(JSON.stringify(r1.body));
  const r2 = await request(app)
    .post('/api/auth/verify')
    .send({ challengeId: r1.body.challengeId, codigo: messenger.last, device: device(kind) });
  if (!r2.body.token) throw new Error(JSON.stringify(r2.body));
  return r2.body as { token: string; deviceId: string; perfil: { id: string } };
}
