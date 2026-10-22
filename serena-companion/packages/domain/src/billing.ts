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

/** orden_compra: plan Empresa por orden de compra y transferencia (sin pasarela; SERENA confirma el pago). */
export type PaymentProviderId = 'stripe' | 'mercadopago' | 'sandbox' | 'orden_compra';

export type SubscriptionStatus =
  | 'sin_suscripcion'
  | 'pendiente'
  /** Orden de compra emitida, a la espera de la transferencia: los puestos ya se pueden usar. */
  | 'orden_pendiente'
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
  /** Tope de puestos (el plan Individual es de 1). Sin tope si no se indica. */
  maximoPuestos?: number;
  /** individual: una persona, paga con Mercado Pago. empresa: orden de compra y transferencia. */
  tipo?: 'individual' | 'empresa';
  /** Proveedores con los que se puede contratar el plan. Todos, si no se indica. */
  proveedores?: PaymentProviderId[];
  /** Id del precio en Stripe (price_...), configurado por entorno. */
  stripePriceId?: string;
}

export type CondicionIva = 'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final';

export const CONDICION_IVA: Record<CondicionIva, string> = {
  responsable_inscripto: 'IVA Responsable Inscripto',
  monotributo: 'Responsable Monotributo',
  exento: 'IVA Exento',
  consumidor_final: 'Consumidor Final',
};

/** Datos de facturación de la empresa para la orden de compra. */
export interface DatosFacturacion {
  razonSocial: string;
  /** 11 dígitos, sin guiones. */
  cuit: string;
  condicionIva: CondicionIva;
  domicilioFiscal: string;
  contactoNombre: string;
  contactoEmail: string;
  contactoTelefono?: string | null;
  /** Número de orden de compra interno de la empresa, si lo usa. */
  ordenInterna?: string | null;
}

/** CUIT/CUIL argentino: 11 dígitos con dígito verificador (módulo 11). */
export function cuitValido(cuit: string): boolean {
  const d = cuit.replace(/\D/g, '');
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return dv === Number(d[10]);
}

export function formatCuit(cuit: string): string {
  const d = cuit.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}` : cuit;
}

export type EstadoOrden = 'pendiente' | 'pagada' | 'vencida' | 'anulada';

export const ESTADO_ORDEN: Record<EstadoOrden, string> = {
  pendiente: 'PENDIENTE DE PAGO',
  pagada: 'PAGADA',
  vencida: 'VENCIDA',
  anulada: 'ANULADA',
};

/** Orden de compra / proforma del plan Empresa, tal como la ve la administración de la empresa. */
export interface OrdenCompra {
  id: string;
  /** Número correlativo legible, p. ej. OC-000012. */
  numero: string;
  estado: EstadoOrden;
  planId: string;
  planNombre: string;
  intervalo: BillingInterval;
  puestos: number;
  moneda: string;
  /** En unidades menores (centavos). */
  precioUnitario: number;
  total: number;
  facturacion: DatosFacturacion;
  emitidaEn: string;
  /** Vencimiento para pagar la orden. */
  venceEn: string;
  pagadaEn: string | null;
  referenciaPago: string | null;
  numeroFactura: string | null;
  /** Renovación: inicio del período que paga (fin del período anterior). Null en la primera orden. */
  periodoDesde?: string | null;
}

/** Datos para la transferencia, configurados por el operador de SERENA. */
export interface DatosTransferencia {
  titular: string;
  cuit: string;
  banco: string;
  cbu: string;
  alias?: string | null;
  /** Casilla donde la empresa envía el comprobante de la transferencia; también es la dirección de respuesta del email de la orden. */
  email?: string | null;
  /** true si son datos de ejemplo (sin configurar): no se debe transferir. */
  ejemplo?: boolean;
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
  orden_pendiente: { etiqueta: 'PENDIENTE DE PAGO (ORDEN DE COMPRA)', tono: 'atencion' },
  activa: { etiqueta: 'ACTIVA', tono: 'ok' },
  en_prueba: { etiqueta: 'PERÍODO DE PRUEBA', tono: 'ok' },
  pago_vencido: { etiqueta: 'PAGO VENCIDO', tono: 'alerta' },
  pausada: { etiqueta: 'PAUSADA', tono: 'atencion' },
  cancelada: { etiqueta: 'CANCELADA', tono: 'neutro' },
};

/**
 * Estados que habilitan las funciones de administración (reportes agregados). La orden de compra pendiente
 * habilita los puestos mientras se tramita la transferencia.
 */
export function isEntitled(s: SubscriptionStatus): boolean {
  return s === 'activa' || s === 'en_prueba' || s === 'orden_pendiente';
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
