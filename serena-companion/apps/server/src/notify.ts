import { createHmac } from 'node:crypto';

/**
 * Integraciones salientes, detrás de interfaces para poder cambiar de proveedor
 * sin tocar las rutas:
 * - Messenger: envía el código del segundo factor (SMS). En desarrollo lo
 *   imprime en la consola.
 * - GuardNotifier: avisa a la guardia de la faena (Protocolo de Escalamiento
 *   Configurable, PEC). Solo la guardia recibe estos avisos, nunca el supervisor.
 */

export type OtpProposito = 'ingreso' | 'recuperacion';

export interface Messenger {
  /** El propósito cambia el texto del SMS ("para ingresar" / "para restablecer tu contraseña"). */
  sendOtp(to: { telefono: string | null; email: string | null }, code: string, proposito?: OtpProposito): Promise<void>;
  /** Aviso de seguridad sin código (p. ej. "cambiaron tu contraseña"). */
  sendAviso(to: { telefono: string | null; email: string | null }, texto: string): Promise<void>;
}

export class ConsoleMessenger implements Messenger {
  async sendOtp(to: { telefono: string | null; email: string | null }, code: string, proposito: OtpProposito = 'ingreso') {
    console.info(`[serena][${proposito === 'ingreso' ? '2FA' : 'recuperación'}] Código para ${to.telefono ?? to.email ?? 'usuario'}: ${code}`);
  }
  async sendAviso(to: { telefono: string | null; email: string | null }, texto: string) {
    console.info(`[serena][aviso] Para ${to.telefono ?? to.email ?? 'usuario'}: ${texto}`);
  }
}

export type GuardAlertType = 'emergencia_fisica' | 'hablar' | 'riesgo' | 'resultado_alto' | 'acompanante_cuidado';
export type EmergencyOrigin = 'boton' | 'resultado_alto' | 'acompanante';

/**
 * Qué recibe la guardia según lo que eligió la persona y desde dónde.
 * Lo que la persona elige manda: "Necesito hablar con alguien" llega como
 * "hablar" aunque lo pida desde el acompañante. Solo se marca como estado de
 * cuidado del acompañante cuando la persona pidió ayuda por riesgo desde ahí.
 */
export function guardAlertType(tipo: 'fisica' | 'hablar' | 'riesgo', origen: EmergencyOrigin): GuardAlertType {
  if (tipo === 'fisica') return 'emergencia_fisica';
  if (origen === 'resultado_alto') return 'resultado_alto';
  if (tipo === 'riesgo' && origen === 'acompanante') return 'acompanante_cuidado';
  return tipo;
}

/** Prioridad para que la guardia ordene la atención. "hablar" no es una urgencia. */
export function guardAlertPriority(t: GuardAlertType): 'alta' | 'normal' {
  return t === 'hablar' ? 'normal' : 'alta';
}

export interface GuardAlert {
  alertId: string;
  orgId: string;
  faena: string;
  tipo: GuardAlertType;
  prioridad: 'alta' | 'normal';
  origen: EmergencyOrigin;
  trabajador: { id: string; nombre: string; legajo: string | null; telefono: string | null };
  ubicacion: { lat: number; lng: number; precisionM: number } | null;
  creadoEn: string;
  /** Resumen de avisos repetidos: cuántos pedidos agrupa esta notificación (ausente si es uno solo). */
  agrupados?: number;
}

export interface GuardNotifier {
  readonly canal: string;
  notify(alert: GuardAlert): Promise<{ entregado: boolean }>;
}

/** Webhook firmado (HMAC-SHA256 en `X-Serena-Signature`) hacia el sistema de la guardia. */
export class WebhookGuardNotifier implements GuardNotifier {
  readonly canal = 'GUARDIA DE FAENA (PEC)';
  constructor(
    private url: string,
    private secret: string | null,
  ) {}

  async notify(alert: GuardAlert) {
    const body = JSON.stringify(alert);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.secret) headers['x-serena-signature'] = createHmac('sha256', this.secret).update(body).digest('hex');
    try {
      const r = await fetch(this.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
      return { entregado: r.ok };
    } catch (e) {
      console.error('[serena][guardia] No se pudo entregar el aviso', alert.alertId, e);
      return { entregado: false };
    }
  }
}

export class ConsoleGuardNotifier implements GuardNotifier {
  readonly canal = 'GUARDIA DE FAENA (PEC)';
  readonly sent: GuardAlert[] = [];
  async notify(alert: GuardAlert) {
    this.sent.push(alert);
    console.warn(`[serena][guardia] ${alert.tipo}${alert.agrupados ? ` ×${alert.agrupados} (resumen)` : ''} · ${alert.prioridad} · ${alert.faena} · ${alert.trabajador.nombre} · ${alert.alertId}`);
    return { entregado: true };
  }
}
