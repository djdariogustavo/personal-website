import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TwilioMessenger } from './sms/twilio.ts';
import { TwilioVerifyMessenger } from './sms/verify.ts';
import { ConsoleGuardNotifier, WebhookGuardNotifier, type GuardNotifier, type Messenger } from './notify.ts';
import { ResendAvisoOperaciones, type AvisoOperaciones } from './avisoOperaciones.ts';
import { GuardiaDirectaNotifier, GuardiasCombinadas } from './guardiaDirecta.ts';

/**
 * Configuración por variables de entorno. Ver .env.example en la raíz.
 * En producción, SERENA_MASTER_KEY y SERENA_JWT_SECRET son obligatorias.
 */

const isProd = process.env.NODE_ENV === 'production';
const lista = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

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

  /**
   * SMS con Twilio (segundo factor, recuperación y avisos de seguridad). En producción se usa
   * siempre que esté configurado; en desarrollo solo con SERENA_SMS=twilio, para no enviar SMS
   * reales a los teléfonos inventados de los datos de ejemplo ni desde las pruebas.
   */
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? null,
    apiKeySid: process.env.TWILIO_API_KEY_SID ?? null,
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET ?? null,
    from: process.env.TWILIO_FROM_NUMBER ?? null,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? null,
    /** Twilio Verify (VA…): Twilio genera y valida los códigos, sin número propio. Tiene prioridad sobre el remitente. */
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID ?? null,
  },
  smsReal: isProd || process.env.SERENA_SMS === 'twilio',

  /**
   * Avisos por email a quien opera SERENA (p. ej. la cuenta de Twilio rechaza todos los SMS), con Resend.
   * Opcional: sin estas variables, esas fallas quedan solo en los registros con la marca [ALERTA].
   */
  alertas: {
    resendApiKey: process.env.RESEND_API_KEY ?? null,
    from: process.env.SERENA_ALERTAS_FROM ?? null,
    /** Una o más direcciones separadas por comas. */
    to: process.env.SERENA_ALERTAS_EMAIL ?? null,
  },

  /**
   * Escaneo con el SDK real: aislamiento de origen (COOP/COEP, lo exige el SDK) y los orígenes a los que se conecta
   * para la licencia, separados por espacios (los informa el proveedor).
   */
  escaneo: {
    aislamientoOrigen: process.env.SERENA_AISLAMIENTO_ORIGEN === 'true',
    // Por defecto, los hosts medidos con la clave real y el SDK 3.1.15: licencia (licensing-web), modelos (plumbus),
    // textos de la interfaz en español (translations) y la API del proveedor (api.shen.ai, para los tokens).
    connectSrc: (
      process.env.SERENA_ESCANEO_CONNECT_SRC ??
      'https://licensing-web.shen.ai https://plumbus.shen.ai https://translations.shen.ai https://api.shen.ai'
    )
      .split(/\s+/)
      .filter(Boolean),
  },

  guardWebhookUrl: process.env.SERENA_GUARD_WEBHOOK_URL ?? null,
  guardWebhookSecret: process.env.SERENA_GUARD_WEBHOOK_SECRET ?? null,
  /**
   * Aviso directo a la guardia por SMS y email (guardiaDirecta.ts), sin sistema intermedio. Se puede usar solo
   * o junto con el webhook. Listas separadas por comas.
   */
  guardiaDirecta: {
    telefonos: lista(process.env.SERENA_GUARDIA_TELEFONOS),
    emails: lista(process.env.SERENA_GUARDIA_EMAILS),
    zonaHoraria: process.env.SERENA_GUARDIA_ZONA_HORARIA ?? 'America/Argentina/Buenos_Aires',
  },

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

/**
 * Configuración mínima para operar con personas reales. Sin estos canales el servicio prometería algo que
 * no cumple: avisos a la guardia que no llegan a nadie o códigos de ingreso escritos en los registros.
 * En producción el servidor no arranca si falta alguno (ver index.ts).
 */
export function problemasDeProduccion(
  e: Pick<typeof env, 'guardWebhookUrl' | 'guardWebhookSecret'> & {
    smsConfigurado: boolean;
    /** Aviso directo a la guardia: cantidad de destinos y si hay proveedor para cada canal. */
    guardiaDirecta?: { telefonos: number; emails: number; smsConRemitente: boolean; emailConfigurado: boolean };
  },
): string[] {
  const p: string[] = [];
  const d = e.guardiaDirecta ?? { telefonos: 0, emails: 0, smsConRemitente: false, emailConfigurado: false };
  if (!e.guardWebhookUrl && !d.telefonos && !d.emails)
    p.push('Canal hacia la guardia (SERENA_GUARD_WEBHOOK_URL, o SERENA_GUARDIA_TELEFONOS / SERENA_GUARDIA_EMAILS): sin él, los pedidos de ayuda no llegarían a nadie.');
  if (e.guardWebhookUrl && !e.guardWebhookUrl.startsWith('https://')) p.push('SERENA_GUARD_WEBHOOK_URL debe usar https:// (el aviso incluye nombre, teléfono y ubicación).');
  if (e.guardWebhookUrl && !e.guardWebhookSecret) p.push('SERENA_GUARD_WEBHOOK_SECRET: sin firma, la guardia no puede verificar que el aviso viene de SERENA.');
  if (d.telefonos && !d.smsConRemitente)
    p.push('SERENA_GUARDIA_TELEFONOS requiere TWILIO_MESSAGING_SERVICE_SID o TWILIO_FROM_NUMBER (Twilio Verify no envía texto libre).');
  if (d.emails && !d.emailConfigurado) p.push('SERENA_GUARDIA_EMAILS requiere RESEND_API_KEY y SERENA_ALERTAS_FROM.');
  if (!e.smsConfigurado)
    p.push('Twilio (TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET y TWILIO_VERIFY_SERVICE_SID, TWILIO_FROM_NUMBER o TWILIO_MESSAGING_SERVICE_SID): sin SMS no se puede entregar el segundo factor.');
  return p;
}

/** Twilio tiene lo mínimo para enviar: cuenta, API Key y un servicio de Verify o un remitente (número o Messaging Service). */
export function twilioConfigurado(t: (typeof env)['twilio']): boolean {
  return Boolean(t.accountSid && t.apiKeySid && t.apiKeySecret && (t.verifyServiceSid || t.from || t.messagingServiceSid));
}

/** Mensajero de Twilio según la configuración: Verify si hay servicio, si no Programmable Messaging. Null si falta algo. */
export function twilioMessenger(t: (typeof env)['twilio'], aviso: AvisoOperaciones | null = null): Messenger | null {
  if (!twilioConfigurado(t)) return null;
  const base = {
    accountSid: t.accountSid!,
    apiKeySid: t.apiKeySid!,
    apiKeySecret: t.apiKeySecret!,
    from: t.from,
    messagingServiceSid: t.messagingServiceSid,
    avisoOperaciones: aviso,
  };
  return t.verifyServiceSid ? new TwilioVerifyMessenger({ ...base, verifyServiceSid: t.verifyServiceSid }) : new TwilioMessenger(base);
}

/** Proveedores disponibles para el aviso directo a la guardia. */
export function canalesDirectos() {
  const t = env.twilio;
  return {
    /** SMS de texto libre: requiere número o Messaging Service (Verify solo envía su plantilla de código). */
    smsConRemitente: Boolean(t.accountSid && t.apiKeySid && t.apiKeySecret && (t.from || t.messagingServiceSid)),
    emailConfigurado: Boolean(env.alertas.resendApiKey && env.alertas.from),
  };
}

/** Canal hacia la guardia: webhook, aviso directo por SMS y email, ambos o (solo en desarrollo) la consola. */
export function notificadorGuardia(aviso: AvisoOperaciones | null): GuardNotifier {
  const t = env.twilio;
  const gd = env.guardiaDirecta;
  const { smsConRemitente, emailConfigurado } = canalesDirectos();
  const canales: GuardNotifier[] = [];
  if (env.guardWebhookUrl) canales.push(new WebhookGuardNotifier(env.guardWebhookUrl, env.guardWebhookSecret));
  if (gd.telefonos.length || gd.emails.length) {
    const sms =
      gd.telefonos.length && smsConRemitente
        ? new TwilioMessenger({ accountSid: t.accountSid!, apiKeySid: t.apiKeySid!, apiKeySecret: t.apiKeySecret!, from: t.from, messagingServiceSid: t.messagingServiceSid, avisoOperaciones: aviso })
        : null;
    const email = gd.emails.length && emailConfigurado ? new ResendAvisoOperaciones({ apiKey: env.alertas.resendApiKey!, from: env.alertas.from!, to: gd.emails }) : null;
    canales.push(new GuardiaDirectaNotifier(gd, sms, email));
  }
  if (!canales.length) return new ConsoleGuardNotifier();
  return canales.length === 1 ? canales[0]! : new GuardiasCombinadas(canales);
}
