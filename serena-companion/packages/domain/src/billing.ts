/**
 * Suscripción de la organización (servicio de pago).
 *
 * SERENA Companion se contrata por faena/organización. Paga la empresa, nunca
 * el trabajador, y el módulo de pagos está aislado de los datos individuales:
 * solo conoce organización, plan, cantidad de puestos y estado del cobro.
 *
 * Regla de seguridad: el estado del pago NUNCA bloquea el botón de emergencia,
 * el escalamiento a la guardia ni el acceso del trabajador a sus propios datos.
 */

export type PaymentProviderId = 'stripe' | 'mercadopago' | 'sandbox';

export type SubscriptionStatus =
  | 'sin_suscripcion'
  | 'pendiente'
  | 'activa'
  | 'en_prueba'
  | 'pago_vencido'
  | 'pausada'
  | 'cancelada';

export type BillingInterval = 'mensual' | 'anual';

export interface Plan {
  id: string;
  nombre: string;
  descripcion: string;
  intervalo: BillingInterval;
  /** Precio por puesto (trabajador activo) por período, por moneda, en unidades menores (centavos). */
  precioPorPuesto: Partial<Record<'USD' | 'ARS' | 'CLP', number>>;
  minimoPuestos: number;
  /** Id del precio en Stripe (price_...), configurado por entorno. */
  stripePriceId?: string;
}

export interface SubscriptionSummary {
  orgId: string;
  proveedor: PaymentProviderId | null;
  planId: string | null;
  estado: SubscriptionStatus;
  puestos: number;
  puestosEnUso: number;
  moneda: string | null;
  proximoCobro: string | null;
  canceladaAlFinal: boolean;
  actualizadaEn: string | null;
}

export const STATUS_COPY: Record<SubscriptionStatus, { etiqueta: string; tono: 'ok' | 'atencion' | 'alerta' | 'neutro' }> = {
  sin_suscripcion: { etiqueta: 'SIN SUSCRIPCIÓN', tono: 'neutro' },
  pendiente: { etiqueta: 'PAGO PENDIENTE', tono: 'atencion' },
  activa: { etiqueta: 'ACTIVA', tono: 'ok' },
  en_prueba: { etiqueta: 'PERÍODO DE PRUEBA', tono: 'ok' },
  pago_vencido: { etiqueta: 'PAGO VENCIDO', tono: 'alerta' },
  pausada: { etiqueta: 'PAUSADA', tono: 'atencion' },
  cancelada: { etiqueta: 'CANCELADA', tono: 'neutro' },
};

/** Estados que habilitan las funciones de administración (reportes agregados). */
export function isEntitled(s: SubscriptionStatus): boolean {
  return s === 'activa' || s === 'en_prueba';
}

export function formatMoney(minor: number, currency: string): string {
  const decimals = currency === 'CLP' ? 0 : 2;
  return (minor / 10 ** decimals).toLocaleString('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
