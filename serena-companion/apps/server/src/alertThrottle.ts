import type { GuardAlertType } from './notify.ts';

/**
 * Control de avisos repetidos a la guardia.
 *
 * Nunca se rechaza ni se descarta un pedido de ayuda: todos se registran y la
 * persona siempre recibe la confirmación. Lo que se regula es cuántas
 * notificaciones SEPARADAS recibe la guardia, para que una ráfaga (toques
 * repetidos, un equipo con fallas o un uso indebido) no la sature:
 *
 * - Las primeras VENTANA_MAX alertas de una persona en VENTANA_MS se notifican una por una.
 * - Las siguientes se agrupan y la guardia recibe un solo resumen por minuto
 *   con la cantidad, el tipo más grave y la última ubicación.
 * - Si la situación se agrava respecto de lo ya notificado (por ejemplo, de
 *   "hablar" a "emergencia física"), se notifica al instante, sin agrupar.
 */

export const VENTANA_MS = 10 * 60_000;
export const VENTANA_MAX = 3;
export const RESUMEN_CADA_MS = 60_000;

export const SEVERIDAD: Record<GuardAlertType, number> = {
  hablar: 1,
  riesgo: 2,
  acompanante_cuidado: 2,
  resultado_alto: 2,
  emergencia_fisica: 3,
};

export interface RecentAlert {
  tipo: GuardAlertType;
  /** true si se notificó (o se intentó notificar) por separado. */
  notificada: boolean;
}

export function decideAlert(recientes: RecentAlert[], nuevo: GuardAlertType): 'notificar' | 'agrupar' {
  const notificadas = recientes.filter((r) => r.notificada);
  if (notificadas.length < VENTANA_MAX) return 'notificar';
  const maxNotificada = Math.max(...notificadas.map((r) => SEVERIDAD[r.tipo]));
  if (SEVERIDAD[nuevo] > maxNotificada) return 'notificar';
  return 'agrupar';
}

export function masGrave(tipos: GuardAlertType[]): GuardAlertType {
  return tipos.reduce((a, b) => (SEVERIDAD[b] > SEVERIDAD[a] ? b : a));
}
