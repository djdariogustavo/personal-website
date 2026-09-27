import { randomBytes } from 'node:crypto';

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

function devKey(label: string): string {
  // Clave de desarrollo estable por proceso. Nunca usar en producción.
  console.warn(`[serena] ${label} no definida: usando una clave efímera de desarrollo.`);
  return randomBytes(32).toString('base64');
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
