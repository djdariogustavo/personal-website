import type { GuardAlert, GuardAlertType, GuardNotifier, Messenger } from './notify.ts';
import type { ResendAvisoOperaciones } from './avisoOperaciones.ts';

/**
 * Aviso directo a la guardia por SMS y email, sin un sistema intermedio: para faenas sin un sistema propio que
 * reciba el webhook. Usa los mismos proveedores que el resto de SERENA (Twilio y Resend), así que el nombre,
 * el teléfono y la ubicación de la persona no pasan por terceros nuevos.
 *
 * Se envía a todos los destinos a la vez. "entregado" significa que al menos un proveedor aceptó el envío
 * (igual que el webhook: la respuesta del receptor, no la lectura de una persona). Si ninguno lo acepta, la
 * app lo dice y sugiere la radio. En los registros nunca va el nombre ni el teléfono de la persona.
 */
export interface ConfigGuardiaDirecta {
  /** Teléfonos de la guardia en formato internacional. */
  telefonos: string[];
  emails: string[];
  /** Zona horaria para la hora del aviso, p. ej. America/Argentina/Buenos_Aires. */
  zonaHoraria: string;
}

const TITULO: Record<GuardAlertType, string> = {
  emergencia_fisica: 'EMERGENCIA FISICA',
  riesgo: 'Pide ayuda (riesgo)',
  resultado_alto: 'Resultado alto en el check-in',
  acompanante_cuidado: 'Pide ayuda desde el acompanante',
  hablar: 'Necesita hablar con alguien',
};

const hora = (iso: string, zona: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

const mapa = (u: NonNullable<GuardAlert['ubicacion']>) => `https://maps.google.com/?q=${u.lat.toFixed(5)},${u.lng.toFixed(5)}`;

/** SMS breve: qué pasa, quién, cómo contactarla y dónde está. */
export function textoSmsGuardia(a: GuardAlert, zona: string): string {
  const t = a.trabajador;
  return [
    `SERENA GUARDIA${a.prioridad === 'alta' ? ' [ALTA]' : ''}: ${TITULO[a.tipo]}${a.agrupados ? ` (${a.agrupados} avisos)` : ''}.`,
    `${t.nombre}${t.legajo ? ` (leg. ${t.legajo})` : ''}${t.telefono ? `, tel ${t.telefono}` : ''}.`,
    a.ubicacion ? `Ubicacion: ${mapa(a.ubicacion)} (±${Math.round(a.ubicacion.precisionM)} m).` : 'Sin ubicacion.',
    `${a.faena}, ${hora(a.creadoEn, zona)} h.`,
  ].join(' ');
}

export function textoEmailGuardia(a: GuardAlert, zona: string): { asunto: string; texto: string } {
  const t = a.trabajador;
  const asunto = `${a.prioridad === 'alta' ? 'ALTA · ' : ''}${TITULO[a.tipo]} · ${t.nombre} · ${a.faena}`;
  const texto = [
    `${TITULO[a.tipo]}${a.agrupados ? ` (agrupa ${a.agrupados} avisos)` : ''}`,
    `Prioridad: ${a.prioridad}`,
    '',
    `Persona: ${t.nombre}`,
    `Legajo: ${t.legajo ?? '—'}`,
    `Teléfono: ${t.telefono ?? '—'}`,
    a.ubicacion ? `Ubicación: ${mapa(a.ubicacion)} (precisión ±${Math.round(a.ubicacion.precisionM)} m)` : 'Ubicación: no disponible',
    `Faena: ${a.faena}`,
    `Hora: ${hora(a.creadoEn, zona)} (${a.creadoEn})`,
    `Aviso: ${a.alertId}`,
    '',
    'Contactar a la persona y registrar la atención según el protocolo de la faena.',
  ].join('\n');
  return { asunto, texto };
}

export class GuardiaDirectaNotifier implements GuardNotifier {
  readonly canal = 'GUARDIA DE FAENA (PEC)';
  constructor(
    private readonly cfg: ConfigGuardiaDirecta,
    /** Mensajero con remitente propio (número o Messaging Service): Verify no envía texto libre. */
    private readonly sms: Messenger | null,
    private readonly email: Pick<ResendAvisoOperaciones, 'enviar'> | null,
  ) {}

  async notify(alert: GuardAlert) {
    const envios: Promise<boolean>[] = [];
    if (this.sms) {
      const texto = textoSmsGuardia(alert, this.cfg.zonaHoraria);
      for (const telefono of this.cfg.telefonos)
        envios.push(
          this.sms.sendAviso({ telefono, email: null }, texto).then(
            () => true,
            () => false,
          ),
        );
    }
    if (this.email && this.cfg.emails.length) {
      const { asunto, texto } = textoEmailGuardia(alert, this.cfg.zonaHoraria);
      envios.push(this.email.enviar(asunto, texto));
    }
    const ok = (await Promise.all(envios)).filter(Boolean).length;
    if (ok < envios.length)
      console.error(`[serena][guardia] Aviso ${alert.alertId}: ${envios.length - ok} de ${envios.length} envíos directos a la guardia fallaron.`);
    return { entregado: ok > 0 };
  }
}

/** Varios canales a la vez (webhook y aviso directo): entregado si al menos uno lo entregó. */
export class GuardiasCombinadas implements GuardNotifier {
  readonly canal = 'GUARDIA DE FAENA (PEC)';
  constructor(private readonly canales: GuardNotifier[]) {}
  async notify(alert: GuardAlert) {
    const r = await Promise.all(this.canales.map((c) => c.notify(alert)));
    return { entregado: r.some((x) => x.entregado) };
  }
}
