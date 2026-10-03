import { createHmac, timingSafeEqual } from 'node:crypto';
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
 * Mercado Pago (Argentina / Chile): suscripciones sin plan asociado
 * (POST /preapproval), cobro mensual por el total de puestos.
 *
 * Webhook: notificación con `type=subscription_preapproval` y `data.id`. La firma
 * viene en `x-signature: ts=...,v1=...` y se valida con HMAC-SHA256 sobre el
 * manifiesto `id:{data.id};request-id:{x-request-id};ts:{ts};` usando la clave
 * secreta del webhook. Luego se consulta el estado real con GET /preapproval/{id}
 * (nunca se confía en el cuerpo de la notificación).
 */

const API = 'https://api.mercadopago.com';

interface Preapproval {
  id: string;
  status: 'pending' | 'authorized' | 'paused' | 'cancelled';
  external_reference?: string;
  init_point?: string;
  next_payment_date?: string;
  payer_id?: number;
  auto_recurring?: { transaction_amount?: number };
}

function mapStatus(s: Preapproval['status']): SubscriptionStatus {
  switch (s) {
    case 'authorized':
      return 'activa';
    case 'paused':
      return 'pausada';
    case 'cancelled':
      return 'cancelada';
    default:
      return 'pendiente';
  }
}

/** external_reference = "<orgId>:<checkoutId>:<puestos>" */
function parseRef(ref: string | undefined) {
  const [orgId, checkoutId, puestos] = (ref ?? '').split(':');
  return { orgId: orgId || null, checkoutId: checkoutId || null, puestos: puestos ? Number(puestos) : undefined };
}

export function verifyMercadoPagoSignature(opts: {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string;
  secret: string;
  toleranceS?: number;
  now?: number;
}): boolean {
  if (!opts.xSignature) return false;
  const parts = Object.fromEntries(
    opts.xSignature.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')];
    }),
  ) as Record<string, string>;
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  if (opts.toleranceS) {
    const tsMs = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
    if (Math.abs((opts.now ?? Date.now()) - tsMs) > opts.toleranceS * 1000) return false;
  }
  // Según la documentación, si data.id es alfanumérico se usa en minúsculas.
  const id = /[a-z]/i.test(opts.dataId) ? opts.dataId.toLowerCase() : opts.dataId;
  let manifest = `id:${id};`;
  if (opts.xRequestId) manifest += `request-id:${opts.xRequestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac('sha256', opts.secret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly id = 'mercadopago' as const;
  readonly nombre = 'Mercado Pago';
  readonly monedas: string[];

  constructor(
    private accessToken: string,
    private webhookSecret: string | null,
    private currency: 'ARS' | 'CLP',
  ) {
    this.monedas = [currency];
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${await r.text()}`);
    return (await r.json()) as T;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutOutput> {
    const unit = input.plan.precioPorPuesto[this.currency];
    if (unit === undefined) throw new Error(`El plan ${input.plan.id} no tiene precio en ${this.currency}`);
    const decimals = this.currency === 'CLP' ? 0 : 2;
    const amount = (unit * input.puestos) / 10 ** decimals;
    const pre = await this.api<Preapproval>('/preapproval', {
      method: 'POST',
      headers: { 'x-idempotency-key': input.checkoutId },
      body: JSON.stringify({
        reason: `SERENA Companion · ${input.plan.nombre} · ${input.puestos} puestos · ${input.org.nombre}`,
        external_reference: `${input.org.id}:${input.checkoutId}:${input.puestos}`,
        payer_email: input.payerEmail,
        back_url: input.successUrl,
        status: 'pending',
        auto_recurring: {
          frequency: input.plan.intervalo === 'anual' ? 12 : 1,
          frequency_type: 'months',
          transaction_amount: amount,
          currency_id: this.currency,
        },
      }),
    });
    if (!pre.init_point) throw new Error('Mercado Pago no devolvió init_point');
    return { url: pre.init_point, externoId: pre.id };
  }

  async parseWebhook(req: WebhookRequest): Promise<NormalizedPaymentEvent | null> {
    const body = JSON.parse(req.rawBody.toString('utf8') || '{}') as { type?: string; action?: string; id?: string | number; data?: { id?: string } };
    const topic = body.type ?? String(req.query.type ?? req.query.topic ?? '');
    const dataId = String(req.query['data.id'] ?? body.data?.id ?? '');
    if (!dataId) return null;
    if (!this.webhookSecret) throw new WebhookSignatureError('MERCADOPAGO_WEBHOOK_SECRET no configurado');
    const ok = verifyMercadoPagoSignature({
      xSignature: req.headers['x-signature'] as string | undefined,
      xRequestId: req.headers['x-request-id'] as string | undefined,
      dataId,
      secret: this.webhookSecret,
      toleranceS: 600,
    });
    if (!ok) throw new WebhookSignatureError();
    if (topic !== 'subscription_preapproval' && topic !== 'preapproval') return null;

    const pre = await this.api<Preapproval>(`/preapproval/${encodeURIComponent(dataId)}`);
    const ref = parseRef(pre.external_reference);
    return {
      // Un mismo preapproval notifica varias veces: el id del evento combina id + estado.
      eventoId: `${body.id ?? dataId}:${pre.status}`,
      tipo: `${topic}.${body.action ?? 'updated'}`,
      orgId: ref.orgId,
      checkoutId: ref.checkoutId,
      cambios: {
        estado: mapStatus(pre.status),
        externoSuscripcion: pre.id,
        externoCliente: pre.payer_id ? String(pre.payer_id) : null,
        puestos: ref.puestos,
        proximoCobro: pre.next_payment_date ?? null,
      },
    };
  }

  async cancel(externoSuscripcion: string): Promise<void> {
    await this.api(`/preapproval/${encodeURIComponent(externoSuscripcion)}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'cancelled' }),
    });
  }
}
