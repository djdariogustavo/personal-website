import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CheckoutInput,
  CheckoutOutput,
  NormalizedPaymentEvent,
  PaymentProvider,
  WebhookRequest,
} from './types.ts';
import { WebhookSignatureError } from './types.ts';

/**
 * Proveedor simulado para desarrollo, demos y pruebas automáticas. Recorre el
 * mismo camino que un proveedor real: checkout → webhook firmado → cambio de
 * estado. La "pasarela" es una página de la propia app (/admin/facturacion/sandbox).
 */
export class SandboxProvider implements PaymentProvider {
  readonly id = 'sandbox' as const;
  readonly nombre = 'Pasarela de prueba';
  readonly monedas = ['USD', 'ARS', 'CLP'];

  constructor(
    private secret: string,
    private publicUrl: string,
  ) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutOutput> {
    const q = new URLSearchParams({
      checkout: input.checkoutId,
      plan: input.plan.nombre,
      puestos: String(input.puestos),
      moneda: input.moneda,
    });
    return { url: `${this.publicUrl}/admin/facturacion/sandbox?${q}`, externoId: `sbx_${input.checkoutId}` };
  }

  sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  /** Cuerpo del webhook que "envía" la pasarela de prueba al confirmar o rechazar el pago. */
  buildEvent(checkoutId: string, orgId: string, puestos: number, aprobado: boolean) {
    const body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      tipo: aprobado ? 'pago.aprobado' : 'pago.rechazado',
      orgId,
      checkoutId,
      puestos,
      suscripcion: `sbx_sub_${checkoutId}`,
    });
    return { body, signature: this.sign(body) };
  }

  async parseWebhook(req: WebhookRequest): Promise<NormalizedPaymentEvent | null> {
    const sig = String(req.headers['x-sandbox-signature'] ?? '');
    const expected = this.sign(req.rawBody.toString('utf8'));
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookSignatureError();
    const e = JSON.parse(req.rawBody.toString('utf8')) as {
      id: string;
      tipo: string;
      orgId: string;
      checkoutId: string;
      puestos: number;
      suscripcion: string;
    };
    const next = new Date();
    next.setMonth(next.getMonth() + 1);
    return {
      eventoId: e.id,
      tipo: e.tipo,
      orgId: e.orgId,
      checkoutId: e.checkoutId,
      cambios:
        e.tipo === 'pago.aprobado'
          ? {
              estado: 'activa',
              externoSuscripcion: e.suscripcion,
              externoCliente: `sbx_cus_${e.orgId}`,
              puestos: e.puestos,
              proximoCobro: next.toISOString(),
              canceladaAlFinal: false,
            }
          : { estado: 'pendiente' },
    };
  }

  async cancel(): Promise<void> {
    /* sin efecto externo */
  }
}
