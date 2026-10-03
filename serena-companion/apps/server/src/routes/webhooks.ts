import express, { Router } from 'express';
import type { AppContext } from '../context.ts';
import { HttpError } from '../auth.ts';
import { applyPaymentEvent } from '../payments/index.ts';
import { WebhookSignatureError } from '../payments/types.ts';

/**
 * Webhooks de los proveedores de pago: POST /api/billing/webhooks/:proveedor
 * Necesitan el cuerpo crudo para verificar la firma, por eso se montan antes
 * del parser JSON general.
 */
export function webhookRoutes(ctx: AppContext) {
  const r = Router();
  r.post('/billing/webhooks/:proveedor', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const provider = ctx.payments.get(String(req.params.proveedor));
    if (!provider) throw new HttpError(404, 'proveedor_no_disponible');
    let ev;
    try {
      ev = await provider.parseWebhook({
        rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
        headers: req.headers,
        query: req.query as Record<string, unknown>,
      });
    } catch (e) {
      if (e instanceof WebhookSignatureError) throw new HttpError(400, 'firma_invalida', e.message);
      throw e;
    }
    if (!ev) return res.json({ recibido: true, ignorado: true });
    const nuevo = applyPaymentEvent(ctx.db, provider.id, ev);
    res.json({ recibido: true, duplicado: !nuevo });
  });
  return r;
}
