import type { PaymentProviderId, Plan, SubscriptionSummary } from '@serena/domain';
import type { DB } from '../db.ts';
import { nowIso, tx } from '../db.ts';
import type { NormalizedPaymentEvent, PaymentProvider } from './types.ts';
import { StripeProvider } from './stripe.ts';
import { MercadoPagoProvider } from './mercadopago.ts';
import { SandboxProvider } from './sandbox.ts';

/**
 * Catálogo de planes. PRECIOS DE EJEMPLO: los define el área comercial y se
 * reemplazan por configuración (SERENA_PLANS_JSON) antes de publicar.
 */
export const DEFAULT_PLANS: Plan[] = [
  {
    id: 'faena-mensual',
    nombre: 'Faena · mensual',
    descripcion: 'Companion para cada trabajador de la faena, kiosco incluido. Se cobra por puesto activo.',
    intervalo: 'mensual',
    precioPorPuesto: { USD: 900, ARS: 900_000, CLP: 8_500 },
    minimoPuestos: 20,
  },
  {
    id: 'faena-anual',
    nombre: 'Faena · anual',
    descripcion: 'Igual al mensual, con un pago por año.',
    intervalo: 'anual',
    precioPorPuesto: { USD: 9_000, ARS: 9_000_000, CLP: 85_000 },
    minimoPuestos: 20,
  },
];

export function loadPlans(): Plan[] {
  const raw = process.env.SERENA_PLANS_JSON;
  return raw ? (JSON.parse(raw) as Plan[]) : DEFAULT_PLANS;
}

export class PaymentRegistry {
  private providers = new Map<PaymentProviderId, PaymentProvider>();
  constructor(public plans: Plan[]) {}

  register(p: PaymentProvider) {
    this.providers.set(p.id, p);
    return this;
  }
  get(id: string): PaymentProvider | undefined {
    return this.providers.get(id as PaymentProviderId);
  }
  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }
  plan(id: string): Plan | undefined {
    return this.plans.find((p) => p.id === id);
  }
}

export function buildRegistry(opts: {
  stripe: { secretKey: string | null; webhookSecret: string | null; priceIds: Record<string, string> };
  mercadopago: { accessToken: string | null; webhookSecret: string | null; currency: 'ARS' | 'CLP' };
  sandbox: boolean;
  sandboxSecret: string;
  publicUrl: string;
}): PaymentRegistry {
  const reg = new PaymentRegistry(loadPlans());
  if (opts.stripe.secretKey) reg.register(new StripeProvider(opts.stripe.secretKey, opts.stripe.webhookSecret, opts.stripe.priceIds));
  if (opts.mercadopago.accessToken)
    reg.register(new MercadoPagoProvider(opts.mercadopago.accessToken, opts.mercadopago.webhookSecret, opts.mercadopago.currency));
  if (opts.sandbox) reg.register(new SandboxProvider(opts.sandboxSecret));
  return reg;
}

interface SubRow {
  org_id: string;
  proveedor: PaymentProviderId | null;
  plan_id: string | null;
  estado: SubscriptionSummary['estado'];
  puestos: number;
  moneda: string | null;
  externo_cliente: string | null;
  externo_suscripcion: string | null;
  proximo_cobro: string | null;
  cancelada_al_final: number;
  actualizada_en: string | null;
}

export function getSubscriptionRow(db: DB, orgId: string): SubRow | undefined {
  return db.prepare('SELECT * FROM subscriptions WHERE org_id = ?').get(orgId) as SubRow | undefined;
}

export function subscriptionSummary(db: DB, orgId: string): SubscriptionSummary {
  const s = getSubscriptionRow(db, orgId);
  const enUso = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND role = 'worker' AND activo = 1").get(orgId) as { n: number }).n;
  return {
    orgId,
    proveedor: s?.proveedor ?? null,
    planId: s?.plan_id ?? null,
    estado: s?.estado ?? 'sin_suscripcion',
    puestos: s?.puestos ?? 0,
    puestosEnUso: enUso,
    moneda: s?.moneda ?? null,
    proximoCobro: s?.proximo_cobro ?? null,
    canceladaAlFinal: Boolean(s?.cancelada_al_final),
    actualizadaEn: s?.actualizada_en ?? null,
  };
}

/**
 * Aplica un evento normalizado de forma idempotente (tabla payment_events).
 * Devuelve false si el evento ya se había procesado.
 */
export function applyPaymentEvent(db: DB, provider: PaymentProviderId, ev: NormalizedPaymentEvent): boolean {
  return tx(db, () => {
    const inserted = db
      .prepare('INSERT OR IGNORE INTO payment_events (proveedor, evento_id, tipo, org_id, recibido_en) VALUES (?, ?, ?, ?, ?)')
      .run(provider, ev.eventoId, ev.tipo, ev.orgId, nowIso());
    if (inserted.changes === 0) return false;

    let orgId = ev.orgId;
    let checkout: { org_id: string; plan_id: string; puestos: number; moneda: string } | undefined;
    if (ev.checkoutId) {
      checkout = db.prepare('SELECT org_id, plan_id, puestos, moneda FROM checkout_sessions WHERE id = ?').get(ev.checkoutId) as typeof checkout;
      if (checkout) {
        orgId = orgId ?? checkout.org_id;
        if (checkout.org_id !== orgId) throw new Error('El evento no corresponde a la organización del checkout');
        db.prepare("UPDATE checkout_sessions SET estado = 'completado' WHERE id = ?").run(ev.checkoutId);
      }
    }
    if (!orgId) {
      // Buscar por id externo de la suscripción.
      const ext = ev.cambios?.externoSuscripcion;
      const r = ext ? (db.prepare('SELECT org_id FROM subscriptions WHERE externo_suscripcion = ?').get(ext) as { org_id: string } | undefined) : undefined;
      orgId = r?.org_id ?? null;
    }
    if (!orgId) return true; // evento sin organización asociable: se registra y se ignora
    const org = db.prepare('SELECT id FROM orgs WHERE id = ?').get(orgId);
    if (!org) return true;

    const cur = getSubscriptionRow(db, orgId);
    const c = ev.cambios ?? {};
    const next = {
      proveedor: provider,
      plan_id: checkout?.plan_id ?? cur?.plan_id ?? null,
      estado: c.estado ?? cur?.estado ?? 'pendiente',
      puestos: c.puestos ?? checkout?.puestos ?? cur?.puestos ?? 0,
      moneda: checkout?.moneda ?? cur?.moneda ?? null,
      externo_cliente: c.externoCliente ?? cur?.externo_cliente ?? null,
      externo_suscripcion: c.externoSuscripcion ?? cur?.externo_suscripcion ?? null,
      proximo_cobro: c.proximoCobro !== undefined ? c.proximoCobro : (cur?.proximo_cobro ?? null),
      cancelada_al_final: c.canceladaAlFinal !== undefined ? (c.canceladaAlFinal ? 1 : 0) : (cur?.cancelada_al_final ?? 0),
    };
    db.prepare(
      `INSERT INTO subscriptions (org_id, proveedor, plan_id, estado, puestos, moneda, externo_cliente, externo_suscripcion, proximo_cobro, cancelada_al_final, actualizada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET proveedor = excluded.proveedor, plan_id = excluded.plan_id, estado = excluded.estado,
         puestos = excluded.puestos, moneda = excluded.moneda, externo_cliente = excluded.externo_cliente,
         externo_suscripcion = excluded.externo_suscripcion, proximo_cobro = excluded.proximo_cobro,
         cancelada_al_final = excluded.cancelada_al_final, actualizada_en = excluded.actualizada_en`,
    ).run(
      orgId,
      next.proveedor,
      next.plan_id,
      next.estado,
      next.puestos,
      next.moneda,
      next.externo_cliente,
      next.externo_suscripcion,
      next.proximo_cobro,
      next.cancelada_al_final,
      nowIso(),
    );
    return true;
  });
}

export type { PaymentProvider } from './types.ts';
