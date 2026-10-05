import type { PaymentProviderId, Plan, SubscriptionStatus } from '@serena/domain';

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
}

export interface CheckoutOutput {
  /** URL a la que se redirige al administrador para pagar. */
  url: string;
  externoId: string | null;
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
  createCheckout(input: CheckoutInput): Promise<CheckoutOutput>;
  /** Verifica la firma y traduce el webhook. Devuelve null si el evento no nos interesa. Lanza si la firma es inválida. */
  parseWebhook(req: WebhookRequest): Promise<NormalizedPaymentEvent | null>;
  /** Cancela al final del período en curso. */
  cancel(externoSuscripcion: string): Promise<void>;
  /** Portal de autogestión del proveedor (medios de pago, facturas), si existe. */
  portalUrl?(externoCliente: string, returnUrl: string): Promise<string>;
}

export class WebhookSignatureError extends Error {
  constructor(msg = 'Firma de webhook inválida') {
    super(msg);
  }
}
