import { DEMO } from '../../demo/flags.ts';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { type Plan } from '@serena/domain';
import { api } from '../../lib/api.ts';
import { errMsg } from './comun.tsx';

/** Pasarela de prueba: simula la página del proveedor y dispara el webhook firmado. */
export function SandboxCheckout() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const checkoutId = params.get('checkout') ?? '';

  async function decide(aprobado: boolean) {
    try {
      const r = await api<{ webhook?: { body: string; signature: string } }>('/admin/billing/sandbox/complete', { body: { checkoutId, aprobado } });
      // El servidor devuelve el webhook firmado que "enviaría" el proveedor; en la vista previa el estado ya cambió.
      if (!DEMO && r.webhook) {
        const res = await fetch('/api/billing/webhooks/sandbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sandbox-signature': r.webhook.signature },
          body: r.webhook.body,
        });
        if (!res.ok) throw new Error('webhook');
      }
      nav(`/admin/facturacion?resultado=${aprobado ? 'ok' : 'cancelado'}`, { replace: true });
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="screen narrow">
      <span className="sim-chip" style={{ alignSelf: 'flex-start' }}>
        PASARELA DE PRUEBA · NO SE COBRA NADA
      </span>
      <h1 className="h1">Confirmar pago</h1>
      <div className="card">
        <div>
          Plan: <strong>{params.get('plan')}</strong>
        </div>
        <div>
          Puestos: <strong className="num">{params.get('puestos')}</strong> · Moneda: <strong>{params.get('moneda')}</strong>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => void decide(true)}>
          Aprobar pago de prueba
        </button>
        <button type="button" className="btn" onClick={() => void decide(false)}>
          Rechazar
        </button>
      </div>
    </div>
  );
}
