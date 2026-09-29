import type { Messenger, OtpProposito } from '../notify.ts';

/**
 * Envío de SMS con Twilio (Programmable Messaging) por su API REST, sin el SDK:
 * funciona igual en Node y en Cloudflare Workers (A22) y es una dependencia menos.
 *
 * Aquí los códigos los genera y verifica SERENA (hash, vencimiento, intentos y límites en
 * otp.ts y en las rutas); Twilio solo los entrega. Con TWILIO_VERIFY_SERVICE_SID se usa
 * Twilio Verify (sms/verify.ts), que genera y valida el código sin número propio.
 *
 * Nunca se escriben en los registros ni el código ni el teléfono completo.
 */

export interface TwilioConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  /** Número remitente en formato E.164 (+1…) o, en su lugar, un Messaging Service. */
  from?: string | null;
  messagingServiceSid?: string | null;
}

/** Texto de cada SMS: corto y en alfabeto GSM-7 (160 caracteres por segmento). */
export const TEXTOS = {
  ingreso: (c: string) => `SERENA: tu codigo de ingreso es ${c}. Vence en 5 minutos. No lo compartas: nadie de SERENA ni de tu empresa te lo va a pedir.`,
  recuperacion: (c: string) => `SERENA: tu codigo para restablecer la contraseña es ${c}. Vence en 10 minutos. Si no lo pediste, ignora este mensaje.`,
} satisfies Record<OtpProposito, (c: string) => string>;

/**
 * Alfabeto GSM-7 básico (3GPP TS 23.038). Un solo carácter fuera de él obliga a UCS-2:
 * 70 caracteres por segmento en lugar de 160, es decir, el doble o el triple de costo.
 */
const GSM7 = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const SIN_TILDE: Record<string, string> = { á: 'a', í: 'i', ó: 'o', ú: 'u', Á: 'A', Í: 'I', Ó: 'O', Ú: 'U', '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '-', '…': '...' };

/** Lleva el texto a GSM-7 sin perder legibilidad (conserva ñ, é, ü, ¿ y ¡). */
export function aGsm7(texto: string): string {
  return [...texto].map((c) => SIN_TILDE[c] ?? c).join('');
}
export const esGsm7 = (texto: string) => [...texto].every((c) => GSM7.has(c));

/** Normaliza a E.164 ("+54 9 264 555-0147" → "+5492645550147"). Sin "+" no se adivina el país. */
export function aE164(telefono: string): string | null {
  const t = telefono.replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(t) ? t : null;
}

/** Últimos 2 dígitos, para los registros. */
export const enmascarado = (e164: string) => `…${e164.slice(-2)}`;

export class SmsNoEnviado extends Error {
  constructor(
    mensaje: string,
    readonly codigoTwilio: number | null = null,
  ) {
    super(mensaje);
    this.name = 'SmsNoEnviado';
  }
}

export class TwilioMessenger implements Messenger {
  constructor(
    private readonly cfg: TwilioConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!cfg.from && !cfg.messagingServiceSid) throw new Error('Twilio: falta TWILIO_FROM_NUMBER o TWILIO_MESSAGING_SERVICE_SID');
  }

  async sendOtp(to: { telefono: string | null; email: string | null }, code: string, proposito: OtpProposito = 'ingreso') {
    await this.enviar(to.telefono, TEXTOS[proposito](code));
  }

  async sendAviso(to: { telefono: string | null; email: string | null }, texto: string) {
    await this.enviar(to.telefono, texto);
  }

  private async enviar(telefono: string | null, texto: string) {
    const destino = telefono ? aE164(telefono) : null;
    if (!destino) throw new SmsNoEnviado('La persona no tiene un teléfono válido en formato internacional (+54…).');
    const body = new URLSearchParams({ To: destino, Body: aGsm7(texto) });
    if (this.cfg.messagingServiceSid) body.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else body.set('From', this.cfg.from!);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`;
    let r: Response;
    try {
      r = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${this.cfg.apiKeySid}:${this.cfg.apiKeySecret}`)}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      console.error(`[serena][sms] Twilio no respondió (destino ${enmascarado(destino)}):`, (e as Error).name);
      throw new SmsNoEnviado('No pudimos contactar al proveedor de SMS.');
    }
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { code?: number; message?: string };
      // Sin el cuerpo del SMS ni el teléfono completo en los registros.
      console.error(`[serena][sms] Twilio rechazó el envío (HTTP ${r.status}, código ${err.code ?? '—'}, destino ${enmascarado(destino)})`);
      throw new SmsNoEnviado('El proveedor de SMS rechazó el envío.', err.code ?? null);
    }
  }
}
