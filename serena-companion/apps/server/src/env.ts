import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Configuración por variables de entorno. Ver .env.example en la raíz.
 * En producción, SERENA_MASTER_KEY y SERENA_JWT_SECRET son obligatorias.
 */

const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devFallback: () => string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`Falta la variable de entorno ${name}`);
  return devFallback();
}

/**
 * Claves de desarrollo: se generan una vez y se guardan en data/.dev-keys.json
 * (ignorado por git) para que los datos cifrados sigan siendo legibles entre
 * reinicios y entre `npm run seed` y el servidor. Nunca se usan en producción.
 */
const DEV_KEYS_PATH = new URL('../../../data/.dev-keys.json', import.meta.url).pathname;
function devKey(label: string): string {
  let keys: Record<string, string> = {};
  if (existsSync(DEV_KEYS_PATH)) keys = JSON.parse(readFileSync(DEV_KEYS_PATH, 'utf8')) as Record<string, string>;
  if (!keys[label]) {
    keys[label] = randomBytes(32).toString('base64');
    mkdirSync(dirname(DEV_KEYS_PATH), { recursive: true });
    writeFileSync(DEV_KEYS_PATH, JSON.stringify(keys, null, 2), { mode: 0o600 });
    console.warn(`[serena] ${label} no definida: se generó una clave de desarrollo en ${DEV_KEYS_PATH}.`);
  }
  return keys[label]!;
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 8787),
  /** URL pública de la app (para redirecciones de pago y enlaces). */
  publicUrl: process.env.SERENA_PUBLIC_URL ?? 'http://localhost:5173',
  dbPath: process.env.SERENA_DB_PATH ?? new URL('../../../data/serena.db', import.meta.url).pathname,
  /** Clave maestra de 32 bytes en base64: deriva las claves por usuario (AES-256-GCM). */
  masterKey: required('SERENA_MASTER_KEY', () => devKey('SERENA_MASTER_KEY')),
  jwtSecret: required('SERENA_JWT_SECRET', () => devKey('SERENA_JWT_SECRET')),
  /** En desarrollo, el código 2FA se imprime en la consola y se devuelve como pista. */
  exposeDevOtp: !isProd && process.env.SERENA_DEV_OTP !== 'false',

  anthropic: {
    enabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.SERENA_COMPANION_MODEL ?? 'claude-opus-5',
  },

  guardWebhookUrl: process.env.SERENA_GUARD_WEBHOOK_URL ?? null,
  guardWebhookSecret: process.env.SERENA_GUARD_WEBHOOK_SECRET ?? null,

  payments: {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY ?? null,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
      /** JSON {"planId":"price_..."} con los precios configurados en Stripe. */
      priceIds: JSON.parse(process.env.STRIPE_PRICE_IDS ?? '{}') as Record<string, string>,
    },
    mercadopago: {
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? null,
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET ?? null,
      currency: (process.env.MERCADOPAGO_CURRENCY ?? 'ARS') as 'ARS' | 'CLP',
    },
    /** Proveedor simulado para desarrollo y demos. Desactivado en producción salvo que se pida. */
    sandbox: !isProd || process.env.SERENA_PAYMENTS_SANDBOX === 'true',
  },
};
