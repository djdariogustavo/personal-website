import type { DatosFacturacion, PaymentProviderId, Plan, SubscriptionStatus } from '@serena/domain';

/**
 * Contrato común para conectar un servicio de pago. Para sumar otro proveedor
 * (p. ej. dLocal, PayPal, Transbank) se implementa esta interfaz y se registra
 * en payments/index.ts. Las rutas y la UI no cambian.
 */

export interface CheckoutInput {
  checkoutId: string;
  org: { id: string; nombre: string };
  plan: Plan;
  puestos: number;
  moneda: string;
  payerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Datos de facturación de la empresa (los exige la orden de compra). */
  facturacion?: DatosFacturacion;
}

export interface CheckoutOutput {
  /** URL a la que se redirige al administrador para pagar. */
  url: string;
  externoId: string | null;
  /** Estado en que queda la suscripción al iniciar (p. ej. orden_pendiente). Por defecto, pendiente. */
  estadoInicial?: SubscriptionStatus;
}

/** Evento normalizado que produce cada proveedor a partir de su webhook. */
export interface NormalizedPaymentEvent {
  eventoId: string;
  tipo: string;
  orgId: string | null;
  checkoutId?: string | null;
  cambios?: {
    estado?: SubscriptionStatus;
    externoCliente?: string | null;
    externoSuscripcion?: string | null;
    puestos?: number;
    proximoCobro?: string | null;
    canceladaAlFinal?: boolean;
  };
}

export interface WebhookRequest {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly nombre: string;
  readonly monedas: string[];
  /** true si el checkout necesita los datos de facturación de la empresa. */
  readonly requiereFacturacion?: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutOutput>;
  /** Verifica la firma y traduce el webhook. Devuelve null si el evento no nos interesa. Lanza si la firma es inválida. */
  parseWebhook(req: WebhookRequest): Promise<NormalizedPaymentEvent | null>;
  /**
   * Cancela la suscripción. Por defecto, al final del período en curso; devuelve { inmediata: true } si el
   * proveedor la cancela en el acto.
   */
  cancel(externoSuscripcion: string, estado?: SubscriptionStatus): Promise<void | { inmediata: boolean }>;
  /** Portal de autogestión del proveedor (medios de pago, facturas), si existe. */
  portalUrl?(externoCliente: string, returnUrl: string): Promise<string>;
}

export class WebhookSignatureError extends Error {
  constructor(msg = 'Firma de webhook inválida') {
    super(msg);
  }
}

/**
 * Rechazo del proveedor que la persona puede resolver (p. ej. un email de pagador inválido). Lleva un mensaje en
 * español para mostrarle; el detalle original del proveedor va en `message`, para los registros.
 */
export class ErrorProveedorPago extends Error {
  constructor(
    detalle: string,
    readonly codigo: string,
    readonly mensajePersona: string,
  ) {
    super(detalle);
  }
}
