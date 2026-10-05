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
  /**
   * Presente si el proveedor genera y valida el código por su cuenta (Twilio Verify). Entonces SERENA
   * no conoce el código ni usa sendOtp; los desafíos, vencimientos, intentos y límites siguen en SERENA.
   */
  readonly verificador?: VerificadorOtp;
}

export interface VerificadorOtp {
  enviar(telefono: string | null, proposito: OtpProposito): Promise<void>;
  /** true si el proveedor aprobó el código; false si no coincide, venció o ya se usó. */
  comprobar(telefono: string | null, codigo: string): Promise<boolean>;
}

const produccion = () => process.env.NODE_ENV === 'production';

/**
 * Solo desarrollo: escribe el código en la consola. En producción nunca escribe códigos ni teléfonos
 * en los registros (quien los leyera podría ingresar a la cuenta); el servidor además no arranca sin
 * un proveedor de SMS real (env.ts, problemasDeProduccion).
 */
export class ConsoleMessenger implements Messenger {
  async sendOtp(to: { telefono: string | null; email: string | null }, code: string, proposito: OtpProposito = 'ingreso') {
    if (produccion()) return void console.error('[serena][sms] Sin proveedor de SMS: el código no se entregó.');
    console.info(`[serena][${proposito === 'ingreso' ? '2FA' : 'recuperación'}] Código para ${to.telefono ?? to.email ?? 'usuario'}: ${code}`);
  }
  async sendAviso(to: { telefono: string | null; email: string | null }, texto: string) {
    if (produccion()) return;
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

/**
 * Simulador de la guardia para desarrollo y demos: informa "entregado" y lo escribe en la consola.
 * En producción NUNCA informa "entregado" (nadie lo recibe: la app debe decir la verdad y sugerir la
 * radio) ni escribe el nombre de la persona en los registros.
 */
export class ConsoleGuardNotifier implements GuardNotifier {
  readonly canal = 'GUARDIA DE FAENA (PEC)';
  readonly sent: GuardAlert[] = [];
  async notify(alert: GuardAlert) {
    this.sent.push(alert);
    if (produccion()) {
      console.error(`[serena][guardia] SIN CANAL CONFIGURADO: el aviso ${alert.alertId} no llegó a la guardia.`);
      return { entregado: false };
    }
    console.warn(`[serena][guardia] ${alert.tipo}${alert.agrupados ? ` ×${alert.agrupados} (resumen)` : ''} · ${alert.prioridad} · ${alert.faena} · ${alert.trabajador.nombre} · ${alert.alertId}`);
    return { entregado: true };
  }
}
