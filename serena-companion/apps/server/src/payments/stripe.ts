import Stripe from 'stripe';
import type { SubscriptionStatus } from '@serena/domain';
import type {
  CheckoutInput,
  CheckoutOutput,
  NormalizedPaymentEvent,
  PaymentProvider,
  WebhookRequest,
} from './types.ts';
import { WebhookSignatureError } from './types.ts';

/**
 * Stripe Billing: Checkout en modo suscripción, cantidad = puestos.
 * Webhooks: checkout.session.completed, customer.subscription.{created,updated,deleted},
 * invoice.payment_failed. La firma se valida con STRIPE_WEBHOOK_SECRET.
 */

function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case 'active':
      return 'activa';
    case 'trialing':
      return 'en_prueba';
    case 'past_due':
    case 'unpaid':
      return 'pago_vencido';
    case 'paused':
      return 'pausada';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelada';
    case 'incomplete':
    default:
      return 'pendiente';
  }
}

function periodEnd(sub: Stripe.Subscription): string | null {
  // Desde la API 2025-03 el fin de período vive en cada ítem.
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const ts = item?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  readonly nombre = 'Stripe';
  readonly monedas = ['USD'];
  private stripe: Stripe;

  constructor(
    secretKey: string,
    private webhookSecret: string | null,
    private priceIds: Record<string, string>,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutOutput> {
    const price = this.priceIds[input.plan.id] ?? input.plan.stripePriceId;
    if (!price) throw new Error(`No hay precio de Stripe configurado para el plan ${input.plan.id} (STRIPE_PRICE_IDS)`);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: input.puestos }],
      client_reference_id: input.org.id,
      customer_email: input.payerEmail,
      metadata: { orgId: input.org.id, checkoutId: input.checkoutId, planId: input.plan.id },
      subscription_data: { metadata: { orgId: input.org.id, planId: input.plan.id } },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: 'es',
    });
    if (!session.url) throw new Error('Stripe no devolvió la URL de pago');
    return { url: session.url, externoId: session.id };
  }

  async parseWebhook(req: WebhookRequest): Promise<NormalizedPaymentEvent | null> {
    if (!this.webhookSecret) throw new WebhookSignatureError('STRIPE_WEBHOOK_SECRET no configurado');
    const sig = req.headers['stripe-signature'];
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(req.rawBody, String(sig ?? ''), this.webhookSecret);
    } catch {
      throw new WebhookSignatureError();
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        return {
          eventoId: event.id,
          tipo: event.type,
          orgId: s.metadata?.orgId ?? s.client_reference_id ?? null,
          checkoutId: s.metadata?.checkoutId ?? null,
          cambios: {
            externoCliente: typeof s.customer === 'string' ? s.customer : (s.customer?.id ?? null),
            externoSuscripcion: typeof s.subscription === 'string' ? s.subscription : (s.subscription?.id ?? null),
          },
        };
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        return {
          eventoId: event.id,
          tipo: event.type,
          orgId: sub.metadata?.orgId ?? null,
          cambios: {
            estado: event.type === 'customer.subscription.deleted' ? 'cancelada' : mapStatus(sub.status),
            externoCliente: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
            externoSuscripcion: sub.id,
            puestos: sub.items.data[0]?.quantity ?? undefined,
            proximoCobro: periodEnd(sub),
            canceladaAlFinal: sub.cancel_at_period_end,
          },
        };
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice & { parent?: { subscription_details?: { metadata?: Record<string, string> } } };
        return {
          eventoId: event.id,
          tipo: event.type,
          orgId: inv.parent?.subscription_details?.metadata?.orgId ?? null,
          cambios: { estado: 'pago_vencido' },
        };
      }
      default:
        return null;
    }
  }

  async cancel(externoSuscripcion: string): Promise<void> {
    await this.stripe.subscriptions.update(externoSuscripcion, { cancel_at_period_end: true });
  }

  async portalUrl(externoCliente: string, returnUrl: string): Promise<string> {
    const s = await this.stripe.billingPortal.sessions.create({ customer: externoCliente, return_url: returnUrl, locale: 'es' });
    return s.url;
  }
}
