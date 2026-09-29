import type { Messenger, OtpProposito, VerificadorOtp } from '../notify.ts';
import { SmsNoEnviado, TwilioMessenger, aE164, enmascarado, type TwilioConfig } from './twilio.ts';

/**
 * Twilio Verify: Twilio genera, entrega (con remitentes compartidos, sin número propio) y valida el
 * código. SERENA conserva los desafíos, vencimientos, intentos y límites (otp.ts).
 *
 * Verify solo envía su plantilla de código: los avisos de seguridad sin código (sendAviso) salen por
 * Programmable Messaging si hay remitente propio (número o Messaging Service); si no, no se envían.
 *
 * Nunca se escriben en los registros ni el código ni el teléfono completo.
 */

export interface TwilioVerifyConfig extends TwilioConfig {
  verifyServiceSid: string;
}

/** Códigos de Verify que significan "este código no sirve", no una falla del servicio. */
const CODIGO_NO_VALE = new Set([20404, 60202]);

export class TwilioVerifyMessenger implements Messenger {
  readonly verificador: VerificadorOtp;
  private readonly avisos: TwilioMessenger | null;

  constructor(
    private readonly cfg: TwilioVerifyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.avisos = cfg.from || cfg.messagingServiceSid ? new TwilioMessenger(cfg, fetchImpl) : null;
    this.verificador = {
      enviar: (telefono, proposito) => this.enviar(telefono, proposito),
      comprobar: (telefono, codigo) => this.comprobar(telefono, codigo),
    };
  }

  async sendOtp(): Promise<void> {
    throw new Error('Con Twilio Verify el código lo genera Twilio: usar messenger.verificador.');
  }

  async sendAviso(to: { telefono: string | null; email: string | null }, texto: string) {
    if (this.avisos) return this.avisos.sendAviso(to, texto);
    console.warn('[serena][sms] Aviso de seguridad no enviado: Twilio Verify no envía texto libre y no hay número ni Messaging Service.');
  }

  private async enviar(telefono: string | null, _proposito: OtpProposito) {
    const destino = telefono ? aE164(telefono) : null;
    if (!destino) throw new SmsNoEnviado('La persona no tiene un teléfono válido en formato internacional (+54…).');
    // El texto es la plantilla del servicio de Verify (en español), igual para ingreso y recuperación.
    const r = await this.post('Verifications', { To: destino, Channel: 'sms', Locale: 'es' }, destino);
    if (!r.ok) {
      const err = await detalle(r);
      console.error(`[serena][sms] Twilio Verify rechazó el envío (HTTP ${r.status}, código ${err.code ?? '—'}, destino ${enmascarado(destino)})`);
      throw new SmsNoEnviado('El proveedor de SMS rechazó el envío.', err.code ?? null);
    }
  }

  private async comprobar(telefono: string | null, codigo: string): Promise<boolean> {
    const destino = telefono ? aE164(telefono) : null;
    if (!destino) return false;
    const r = await this.post('VerificationCheck', { To: destino, Code: codigo }, destino);
    if (r.ok) return ((await r.json().catch(() => ({}))) as { status?: string }).status === 'approved';
    const err = await detalle(r);
    // 404: la verificación venció, ya se aprobó o no existe. 60202: demasiados intentos. En ambos, el código no vale.
    if (r.status === 404 || CODIGO_NO_VALE.has(err.code ?? 0)) return false;
    console.error(`[serena][sms] Twilio Verify no pudo validar el código (HTTP ${r.status}, código ${err.code ?? '—'}, destino ${enmascarado(destino)})`);
    throw new SmsNoEnviado('El proveedor de SMS no pudo validar el código.', err.code ?? null);
  }

  private async post(recurso: 'Verifications' | 'VerificationCheck', campos: Record<string, string>, destino: string): Promise<Response> {
    const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(this.cfg.verifyServiceSid)}/${recurso}`;
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${this.cfg.apiKeySid}:${this.cfg.apiKeySecret}`)}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(campos),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      console.error(`[serena][sms] Twilio Verify no respondió (destino ${enmascarado(destino)}):`, (e as Error).name);
      throw new SmsNoEnviado('No pudimos contactar al proveedor de SMS.');
    }
  }
}

const detalle = async (r: Response) => (await r.json().catch(() => ({}))) as { code?: number; message?: string };
