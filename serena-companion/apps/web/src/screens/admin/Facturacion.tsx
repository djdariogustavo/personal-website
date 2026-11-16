import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CONDICION_IVA, ESTADO_ORDEN, formatMoney, isEntitled, STATUS_COPY, type CondicionIva, type DatosFacturacion, type OrdenCompra, type Plan, type SubscriptionSummary } from '@serena/domain';
import { api } from '../../lib/api.ts';
import { errMsg, Stat } from './comun.tsx';

interface BillingInfo {
  suscripcion: SubscriptionSummary;
  planes: Plan[];
  proveedores: Array<{ id: string; nombre: string; monedas: string[]; requiereFacturacion?: boolean }>;
}

type Camino = 'individual' | 'empresa';

const FACTURACION_VACIA: DatosFacturacion = {
  razonSocial: '',
  cuit: '',
  condicionIva: 'responsable_inscripto',
  domicilioFiscal: '',
  contactoNombre: '',
  contactoEmail: '',
  contactoTelefono: '',
  ordenInterna: '',
};

export function AdminBilling() {
  const nav = useNavigate();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [params] = useSearchParams();
  const [camino, setCamino] = useState<Camino>('empresa');
  const [provider, setProvider] = useState('');
  const [planId, setPlanId] = useState('');
  const [seats, setSeats] = useState(0);
  const [currency, setCurrency] = useState('');
  const [emailPago, setEmailPago] = useState('');
  const [fact, setFact] = useState<DatosFacturacion>(FACTURACION_VACIA);
  /** Error al iniciar el pago: va junto al botón, donde la persona está mirando. */
  const [errorPago, setErrorPago] = useState<string | null>(null);
  const errorPagoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errorPago) errorPagoRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [errorPago]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const resultado = params.get('resultado');

  const load = () => {
    api<{ ordenes: OrdenCompra[] }>('/admin/billing/ordenes')
      .then((r) => setOrdenes(r.ordenes))
      .catch(() => setOrdenes([]));
    return api<BillingInfo>('/admin/billing')
      .then((i) => setInfo(i))
      .catch((e) => setError(errMsg(e)));
  };
  useEffect(() => void load(), []);

  const planesCamino = useMemo(() => (info?.planes ?? []).filter((p) => (p.tipo ?? 'empresa') === camino), [info, camino]);
  const plan = planesCamino.find((p) => p.id === planId) ?? planesCamino[0];
  const provsPlan = useMemo(
    () => (info?.proveedores ?? []).filter((pr) => (!plan?.proveedores || plan.proveedores.includes(pr.id as never)) && Object.keys(plan?.precioPorPuesto ?? {}).some((m) => pr.monedas.includes(m))),
    [info, plan],
  );
  const prov = provsPlan.find((p) => p.id === provider) ?? provsPlan[0];
  const monedas = (prov?.monedas ?? []).filter((m) => plan?.precioPorPuesto[m as 'ARS'] !== undefined);
  const moneda = monedas.includes(currency) ? currency : (monedas[0] ?? '');
  const minimo = plan?.minimoPuestos ?? 1;
  const maximo = plan?.maximoPuestos;
  const puestos = maximo === 1 ? 1 : Math.max(seats, 0);
  useEffect(() => {
    // Al cambiar de camino o de plan, la cantidad arranca en el mínimo (o en los puestos ya en uso).
    if (plan) setSeats((s) => (s >= plan.minimoPuestos && (!plan.maximoPuestos || s <= plan.maximoPuestos) ? s : Math.max(plan.minimoPuestos, Math.min(info?.suscripcion.puestosEnUso ?? 0, plan.maximoPuestos ?? Infinity))));
  }, [plan, info]);

  const total = useMemo(() => {
    const unit = plan?.precioPorPuesto[moneda as 'USD'];
    return unit === undefined ? null : unit * puestos;
  }, [plan, moneda, puestos]);

  const set = (k: keyof DatosFacturacion) => (e: { target: { value: string } }) => setFact((f) => ({ ...f, [k]: e.target.value }));

  async function checkout(e: FormEvent) {
    e.preventDefault();
    if (busy || !plan || !prov) return;
    setErrorPago(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { proveedor: prov.id, planId: plan.id, puestos, moneda };
      if (prov.requiereFacturacion)
        body.facturacion = { ...fact, contactoTelefono: fact.contactoTelefono?.trim() || null, ordenInterna: fact.ordenInterna?.trim() || null };
      else if (emailPago.trim()) body.emailPago = emailPago.trim();
      const r = await api<{ url: string }>('/admin/billing/checkout', { body });
      // La orden de compra y la pasarela de prueba viven dentro de la app; Stripe y Mercado Pago, en su propia página.
      if (r.url.startsWith('/')) nav(r.url);
      else window.location.assign(r.url);
    } catch (err) {
      setErrorPago(errMsg(err));
      setBusy(false);
    }
  }

  const sub = info?.suscripcion;
  const active = sub && isEntitled(sub.estado);
  const st = sub ? STATUS_COPY[sub.estado] : null;
  const tone = st?.tono === 'ok' ? 'chip-ok' : st?.tono === 'atencion' ? 'chip-warn' : st?.tono === 'alerta' ? 'chip-alert' : 'chip-neutral';
  const ordenPendiente = ordenes.find((o) => o.estado === 'pendiente');
  const periodo = plan?.intervalo === 'anual' ? 'año' : 'mes';

  return (
    <div className="screen">
      <div className="stack">
        <div className="label cyan">SERVICIO DE PAGO</div>
        <h1 className="h1">Facturación</h1>
        <p className="muted" style={{ maxWidth: 760 }}>
          SERENA Companion se contrata de forma individual o por empresa, por puesto activo. El estado del pago nunca bloquea el botón de emergencia ni el acceso de cada persona a sus datos.
        </p>
      </div>
      {resultado === 'ok' && <div className="notice">Recibimos la confirmación del proveedor. El estado se actualiza apenas llega la notificación de pago.</div>}
      {resultado === 'cancelado' && <div className="warn-text">El pago se canceló. No se hizo ningún cobro.</div>}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {sub && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label">SUSCRIPCIÓN</div>
            <span className={`chip ${tone}`}>{st?.etiqueta}</span>
          </div>
          <div className="grid" style={{ ['--min' as string]: '180px', gap: 10 }}>
            <Stat label="PLAN" value={info!.planes.find((p) => p.id === sub.planId)?.nombre ?? '—'} />
            <Stat label="PUESTOS" value={`${sub.puestosEnUso} / ${sub.puestos || '—'}`} />
            <Stat label="PROVEEDOR" value={info!.proveedores.find((p) => p.id === sub.proveedor)?.nombre ?? sub.proveedor ?? '—'} />
            <Stat label="PRÓXIMO COBRO" value={sub.proximoCobro ? new Date(sub.proximoCobro).toLocaleDateString('es-AR') : '—'} />
          </div>
          {sub.estado === 'orden_pendiente' && ordenPendiente && (
            <div className="notice">
              Los puestos ya están habilitados. La suscripción se activa cuando SERENA confirme la transferencia de la orden{' '}
              <button type="button" className="btn btn-link" onClick={() => nav(`/admin/facturacion/orden/${ordenPendiente.id}`)}>
                {ordenPendiente.numero}
              </button>
              .
            </div>
          )}
          {sub.canceladaAlFinal && <div className="warn-text">Se cancela al final del período en curso.</div>}
          {active && (
            <div className="row">
              {sub.proveedor === 'stripe' && (
                <button type="button" className="btn" onClick={() => void api<{ url: string }>('/admin/billing/portal', { body: {} }).then((r) => window.location.assign(r.url)).catch((e) => setError(errMsg(e)))}>
                  Medios de pago y facturas
                </button>
              )}
              {!sub.canceladaAlFinal && (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmCancel(true)}>
                  {sub.estado === 'orden_pendiente' ? 'Anular la orden' : 'Cancelar suscripción'}
                </button>
              )}
            </div>
          )}
          {confirmCancel && (
            <div className="card elevated" role="alertdialog">
              <p>
                {sub.estado === 'orden_pendiente' ? '¿Anular la orden de compra pendiente? ' : '¿Cancelar la suscripción? '}
                Las personas conservan el acceso a sus propios datos y al botón de emergencia; los reportes de grupo dejan de estar disponibles.
              </p>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-danger-solid"
                  onClick={() =>
                    void api('/admin/billing/cancel', { body: {} })
                      .then(() => (setConfirmCancel(false), load()))
                      .catch((e) => setError(errMsg(e)))
                  }
                >
                  Sí, {sub.estado === 'orden_pendiente' ? 'anular' : 'cancelar'}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmCancel(false)}>
                  Volver
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {ordenes.length > 0 && (
        <div className="card">
          <div className="label">ÓRDENES DE COMPRA</div>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
            {ordenes.map((o) => (
              <li key={o.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span>
                  <strong className="num">{o.numero}</strong> · {o.planNombre} · {o.puestos} puestos · <span className="num">{formatMoney(o.total, o.moneda)}</span>
                </span>
                <span className="row">
                  <span className="meta">{ESTADO_ORDEN[o.estado]}</span>
                  <button type="button" className="btn" onClick={() => nav(`/admin/facturacion/orden/${o.id}`)}>
                    Ver
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {info && !active && (
        <form className="card" onSubmit={checkout} style={{ gap: 18 }}>
          <div className="label">CONTRATAR</div>
          {info.proveedores.length === 0 ? (
            <p className="muted">No hay medios de pago configurados en el servidor (ver README, sección Facturación).</p>
          ) : (
            <>
              <div className="grid" role="radiogroup" aria-label="Tipo de contratación" style={{ ['--min' as string]: '240px', gap: 10 }}>
                <button type="button" role="radio" className="choice" aria-checked={camino === 'individual'} onClick={() => setCamino('individual')}>
                  <div style={{ fontWeight: 600, color: 'var(--c-text)' }}>Individual</div>
                  <div style={{ fontSize: 14 }}>Una persona. Pago mensual con Mercado Pago.</div>
                </button>
                <button type="button" role="radio" className="choice" aria-checked={camino === 'empresa'} onClick={() => setCamino('empresa')}>
                  <div style={{ fontWeight: 600, color: 'var(--c-text)' }}>Empresa</div>
                  <div style={{ fontSize: 14 }}>Desde 10 puestos. Orden de compra y transferencia bancaria.</div>
                </button>
              </div>
              {planesCamino.length > 1 && (
                <div className="stack">
                  <span className="label">PLAN</span>
                  <div className="grid" style={{ ['--min' as string]: '220px', gap: 10 }}>
                    {planesCamino.map((p) => (
                      <button key={p.id} type="button" className="choice" aria-pressed={p.id === plan?.id} onClick={() => setPlanId(p.id)}>
                        <div style={{ fontWeight: 600, color: 'var(--c-text)' }}>{p.nombre}</div>
                        <div style={{ fontSize: 14 }}>{p.descripcion}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!prov ? (
                <p className="muted">Este plan no tiene un medio de pago habilitado en el servidor.</p>
              ) : (
                <>
                  <div className="grid" style={{ ['--min' as string]: '200px', gap: 12 }}>
                    {provsPlan.length > 1 && (
                      <label className="field">
                        <span className="label">MEDIO DE PAGO</span>
                        <select className="input" value={prov.id} onChange={(e) => setProvider(e.target.value)}>
                          {provsPlan.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {monedas.length > 1 && (
                      <label className="field">
                        <span className="label">MONEDA</span>
                        <select className="input" value={moneda} onChange={(e) => setCurrency(e.target.value)}>
                          {monedas.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {maximo !== 1 && (
                      <label className="field">
                        <span className="label">PUESTOS (MÍNIMO {minimo})</span>
                        <input className="input num" type="number" min={minimo} max={maximo} value={seats} onChange={(e) => setSeats(Math.max(0, Number(e.target.value) || 0))} />
                      </label>
                    )}
                  </div>
                  {prov.requiereFacturacion ? (
                    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
                      <legend className="label">DATOS DE FACTURACIÓN</legend>
                      <div className="grid" style={{ ['--min' as string]: '240px', gap: 12 }}>
                        <label className="field">
                          <span className="label">RAZÓN SOCIAL</span>
                          <input className="input" required value={fact.razonSocial} onChange={set('razonSocial')} autoComplete="organization" />
                        </label>
                        <label className="field">
                          <span className="label">CUIT</span>
                          <input className="input num" required inputMode="numeric" placeholder="30-12345678-9" value={fact.cuit} onChange={set('cuit')} />
                        </label>
                        <label className="field">
                          <span className="label">CONDICIÓN FRENTE AL IVA</span>
                          <select className="input" value={fact.condicionIva} onChange={(e) => setFact((f) => ({ ...f, condicionIva: e.target.value as CondicionIva }))}>
                            {Object.entries(CONDICION_IVA).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="label">DOMICILIO FISCAL</span>
                          <input className="input" required value={fact.domicilioFiscal} onChange={set('domicilioFiscal')} autoComplete="street-address" />
                        </label>
                        <label className="field">
                          <span className="label">CONTACTO DE COMPRAS</span>
                          <input className="input" required value={fact.contactoNombre} onChange={set('contactoNombre')} autoComplete="name" />
                        </label>
                        <label className="field">
                          <span className="label">EMAIL DE COMPRAS</span>
                          <input className="input" type="email" required value={fact.contactoEmail} onChange={set('contactoEmail')} autoComplete="email" />
                        </label>
                        <label className="field">
                          <span className="label">TELÉFONO (OPCIONAL)</span>
                          <input className="input" type="tel" value={fact.contactoTelefono ?? ''} onChange={set('contactoTelefono')} autoComplete="tel" />
                        </label>
                        <label className="field">
                          <span className="label">N.º DE ORDEN DE COMPRA INTERNA (OPCIONAL)</span>
                          <input className="input" value={fact.ordenInterna ?? ''} onChange={set('ordenInterna')} />
                        </label>
                      </div>
                      <span className="meta" style={{ fontSize: 13 }}>
                        Se emite una orden / proforma con los datos para la transferencia y se envía a este email. La factura se emite por separado.
                      </span>
                    </fieldset>
                  ) : (
                    prov.id !== 'sandbox' && (
                      <label className="field">
                        <span className="label">EMAIL DE LA CUENTA QUE PAGA</span>
                        <input className="input" type="email" autoComplete="email" required value={emailPago} onChange={(e) => setEmailPago(e.target.value)} />
                        <span className="meta" style={{ fontSize: 13 }}>
                          El de la cuenta de {prov.nombre} con la que se va a pagar: el proveedor lo exige igual.
                        </span>
                      </label>
                    )
                  )}
                  {total !== null && (
                    <div style={{ fontSize: 17 }}>
                      Total por {periodo}: <strong className="num">{formatMoney(total, moneda)}</strong>
                      <span className="meta" style={{ fontSize: 13 }}> · precios de ejemplo, a definir por el área comercial</span>
                    </div>
                  )}
                  <div className="actions">
                    <button type="submit" className="btn btn-primary" disabled={busy || !plan || puestos < minimo || (maximo !== undefined && puestos > maximo)} aria-busy={busy}>
                      {busy ? 'Procesando…' : prov.requiereFacturacion ? 'Emitir orden de compra' : 'Continuar al pago'}
                    </button>
                  </div>
                  <div ref={errorPagoRef} aria-live="polite">
                    {errorPago && <div className="alert">{errorPago}</div>}
                  </div>
                </>
              )}
            </>
          )}
        </form>
      )}
    </div>
  );
}
