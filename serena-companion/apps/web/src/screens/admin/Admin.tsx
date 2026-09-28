import { DEMO } from '../../demo/flags.ts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { formatMoney, isEntitled, STATUS_COPY, type CeldaPublicable, type Plan, type SubscriptionSummary } from '@serena/domain';
import { api, ApiError, isOffline } from '../../lib/api.ts';

/**
 * Panel de la organización. La empresa solo ve estadísticas anónimas de grupo
 * (k-anonimato) y gestiona el pago. Nunca ve nombres ni resultados individuales.
 */

function errMsg(e: unknown) {
  if (isOffline(e)) return 'Sin conexión.';
  if (e instanceof ApiError) return e.mensaje || e.code;
  return 'Algo salió mal.';
}

interface Stats {
  periodo: { desde: string; hasta: string };
  ventanaDias: number;
  kAnonimato: number;
  kCelda: number;
  participacion: { personas: number | null; checkins: number | null; activos: number };
  porDiaDeRoster: Array<{ dia: number } & CeldaPublicable>;
  escalamientos28d: number | string;
}

const ATENCION = 'repeating-linear-gradient(135deg, var(--warn-fg) 0 5px, var(--alert-fg) 5px 10px)';

/** Fecha corta del período (la ventana termina el lunes a las 00:00 UTC, se muestra el domingo). */
const fecha = (iso: string, finExclusivo = false) =>
  new Date(Date.parse(iso) - (finExclusivo ? 1 : 0)).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function oculto(d: CeldaPublicable, s: Stats): string {
  if (d.motivo === 'grupo_chico') return `Grupo menor a ${s.kAnonimato}: no se muestra`;
  if (d.motivo === 'homogeneo') return 'No se muestra: todo el grupo en el mismo rango identificaría a cada persona';
  return `No se muestra: alguna categoría tiene menos de ${s.kCelda} personas`;
}

export function AdminStats() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<{ code: string; msg: string } | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    api<Stats>('/admin/stats')
      .then(setS)
      .catch((e) => setError({ code: e instanceof ApiError ? e.code : '', msg: errMsg(e) }));
  }, []);

  return (
    <div className="screen">
      <div className="stack">
        <div className="label cyan">ESTADÍSTICAS ANÓNIMAS DEL GRUPO</div>
        <h1 className="h1">Reportes</h1>
        <p className="muted" style={{ maxWidth: 760 }}>
          Solo se muestran grupos de al menos {s?.kAnonimato ?? 5} personas y categorías de al menos {s?.kCelda ?? 3}. Nunca se ven nombres, resultados
          individuales ni conversaciones.
        </p>
        {s && (
          <p className="meta">
            Período: {fecha(s.periodo.desde)} al {fecha(s.periodo.hasta, true)} · se actualiza cada lunes · porcentajes redondeados a 5 puntos
          </p>
        )}
      </div>
      {error && (
        <div className="card">
          <p>{error.msg}</p>
          {error.code === 'suscripcion_inactiva' && (
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={() => nav('/admin/facturacion')}>
                Ir a Facturación
              </button>
            </div>
          )}
        </div>
      )}
      {s && (
        <>
          <div className="grid" style={{ ['--min' as string]: '220px' }}>
            <Stat label="PERSONAS ACTIVAS" value={String(s.participacion.activos)} />
            <Stat label={`PARTICIPARON · ${s.ventanaDias} DÍAS`} value={s.participacion.personas === null ? `< ${s.kAnonimato}` : String(s.participacion.personas)} />
            <Stat label="CHECK-INS" value={s.participacion.checkins === null ? '—' : String(s.participacion.checkins)} />
            <Stat label="PEDIDOS DE AYUDA" value={String(s.escalamientos28d)} />
          </div>
          <figure className="card" style={{ margin: 0 }}>
            <figcaption className="label">DISTRIBUCIÓN DE NIVELES POR DÍA DE ROSTER · EN TURNO</figcaption>
            <div className="row muted" style={{ gap: 14, fontSize: 12 }}>
              {(
                [
                  ['Bien', 'var(--ok-fg)'],
                  ['Moderado', 'var(--warn-fg)'],
                  ['Alto', 'var(--alert-fg)'],
                  ['Moderado o alto (agrupados por ser pocos)', ATENCION],
                ] as const
              ).map(([l, c]) => (
                <span key={l} className="row" style={{ gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, background: c }} />
                  {l}
                </span>
              ))}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>DÍA</th>
                  <th style={{ width: '60%' }}>DISTRIBUCIÓN</th>
                  <th>PERSONAS</th>
                </tr>
              </thead>
              <tbody>
                {s.porDiaDeRoster.map((d) => (
                  <tr key={d.dia}>
                    <td className="num">{d.dia}</td>
                    <td>
                      {d.distribucion?.tipo === 'completa' ? (
                        <div
                          style={{ display: 'flex', gap: 2, height: 14 }}
                          role="img"
                          aria-label={`Bien ${pct(d.distribucion.bajo)}, moderado ${pct(d.distribucion.moderado)}, alto ${pct(d.distribucion.alto)}`}
                          title={`Bien ${pct(d.distribucion.bajo)} · Moderado ${pct(d.distribucion.moderado)} · Alto ${pct(d.distribucion.alto)}`}
                        >
                          <span style={{ width: pct(d.distribucion.bajo), background: 'var(--ok-fg)', borderRadius: 2 }} />
                          <span style={{ width: pct(d.distribucion.moderado), background: 'var(--warn-fg)', borderRadius: 2 }} />
                          <span style={{ width: pct(d.distribucion.alto), background: 'var(--alert-fg)', borderRadius: 2 }} />
                        </div>
                      ) : d.distribucion?.tipo === 'agrupada' ? (
                        <div
                          style={{ display: 'flex', gap: 2, height: 14 }}
                          role="img"
                          aria-label={`Bien ${pct(d.distribucion.bajo)}, moderado o alto ${pct(d.distribucion.atencion)}`}
                          title={`Bien ${pct(d.distribucion.bajo)} · Moderado o alto ${pct(d.distribucion.atencion)}`}
                        >
                          <span style={{ width: pct(d.distribucion.bajo), background: 'var(--ok-fg)', borderRadius: 2 }} />
                          <span style={{ width: pct(d.distribucion.atencion), background: ATENCION, borderRadius: 2 }} />
                        </div>
                      ) : (
                        <span className="meta">{oculto(d, s)}</span>
                      )}
                    </td>
                    <td className="num">{d.personas ?? `< ${s.kAnonimato}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        </>
      )}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Stat({ label, value }: { label: string; value: string }) {
  const numeric = /^[\d\s/<.,—-]+$/.test(value);
  return (
    <div className="value-card big" style={{ padding: 20 }}>
      <div className="label" style={{ fontSize: 10.5 }}>
        {label}
      </div>
      <div className="v" style={numeric ? undefined : { fontFamily: 'var(--font-ui)', fontSize: 20, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

interface BillingInfo {
  suscripcion: SubscriptionSummary;
  planes: Plan[];
  proveedores: Array<{ id: string; nombre: string; monedas: string[] }>;
}

export function AdminBilling() {
  const nav = useNavigate();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [params] = useSearchParams();
  const [provider, setProvider] = useState('');
  const [planId, setPlanId] = useState('');
  const [seats, setSeats] = useState(0);
  const [currency, setCurrency] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const resultado = params.get('resultado');

  const load = () =>
    api<BillingInfo>('/admin/billing')
      .then((i) => {
        setInfo(i);
        setProvider((p) => p || i.proveedores[0]?.id || '');
        setPlanId((p) => p || i.planes[0]?.id || '');
        setSeats((s) => s || Math.max(i.planes[0]?.minimoPuestos ?? 1, i.suscripcion.puestosEnUso));
      })
      .catch((e) => setError(errMsg(e)));
  useEffect(() => void load(), []);

  const prov = info?.proveedores.find((p) => p.id === provider);
  const plan = info?.planes.find((p) => p.id === planId);
  useEffect(() => {
    if (prov && !prov.monedas.includes(currency)) setCurrency(prov.monedas[0] ?? '');
  }, [prov, currency]);

  const total = useMemo(() => {
    const unit = plan?.precioPorPuesto[currency as 'USD'];
    return unit === undefined ? null : unit * seats;
  }, [plan, currency, seats]);

  async function checkout(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ url: string }>('/admin/billing/checkout', { body: { proveedor: provider, planId, puestos: seats, moneda: currency } });
      // Stripe y Mercado Pago muestran su propia página de pago; la pasarela de prueba vive dentro de la app.
      if (r.url.startsWith('/')) nav(r.url);
      else window.location.assign(r.url);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  const sub = info?.suscripcion;
  const active = sub && isEntitled(sub.estado);
  const st = sub ? STATUS_COPY[sub.estado] : null;
  const tone = st?.tono === 'ok' ? 'chip-ok' : st?.tono === 'atencion' ? 'chip-warn' : st?.tono === 'alerta' ? 'chip-alert' : 'chip-neutral';

  return (
    <div className="screen">
      <div className="stack">
        <div className="label cyan">SERVICIO DE PAGO</div>
        <h1 className="h1">Facturación</h1>
        <p className="muted" style={{ maxWidth: 760 }}>
          SERENA Companion se contrata por faena y se cobra por puesto activo. El estado del pago nunca bloquea el botón de emergencia ni el acceso de cada persona a sus datos.
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
                  Cancelar suscripción
                </button>
              )}
            </div>
          )}
          {confirmCancel && (
            <div className="card elevated" role="alertdialog">
              <p>¿Cancelar la suscripción? Las personas conservan el acceso a sus propios datos y al botón de emergencia; los reportes de grupo dejan de estar disponibles.</p>
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
                  Sí, cancelar
                </button>
                <button type="button" className="btn" onClick={() => setConfirmCancel(false)}>
                  Volver
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {info && !active && (
        <form className="card" onSubmit={checkout} style={{ gap: 18 }}>
          <div className="label">CONTRATAR</div>
          {info.proveedores.length === 0 ? (
            <p className="muted">No hay proveedores de pago configurados en el servidor. Definí STRIPE_SECRET_KEY o MERCADOPAGO_ACCESS_TOKEN (ver README).</p>
          ) : (
            <>
              <div className="stack">
                <span className="label">PLAN</span>
                <div className="grid" style={{ ['--min' as string]: '240px', gap: 10 }}>
                  {info.planes.map((p) => (
                    <button key={p.id} type="button" className="choice" aria-pressed={p.id === planId} onClick={() => setPlanId(p.id)}>
                      <div style={{ fontWeight: 600, color: 'var(--c-text)' }}>{p.nombre}</div>
                      <div style={{ fontSize: 14 }}>{p.descripcion}</div>
                      <div className="meta" style={{ fontSize: 13 }}>
                        Mínimo {p.minimoPuestos} puestos
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid" style={{ ['--min' as string]: '200px', gap: 12 }}>
                <label className="field">
                  <span className="label">PROVEEDOR</span>
                  <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {info.proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">MONEDA</span>
                  <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {prov?.monedas.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">PUESTOS</span>
                  <input className="input num" type="number" min={plan?.minimoPuestos ?? 1} value={seats} onChange={(e) => setSeats(Math.max(0, Number(e.target.value) || 0))} />
                </label>
              </div>
              {total !== null && (
                <div style={{ fontSize: 17 }}>
                  Total por {plan?.intervalo === 'anual' ? 'año' : 'mes'}: <strong className="num">{formatMoney(total, currency)}</strong>
                  <span className="meta" style={{ fontSize: 13 }}> · precios de ejemplo, a definir por el área comercial</span>
                </div>
              )}
              <div className="actions">
                <button type="submit" className="btn btn-primary" disabled={busy || !plan || seats < (plan?.minimoPuestos ?? 1)}>
                  Continuar al pago
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}

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

interface Trabajador {
  id: string;
  nombre: string;
  legajo: string | null;
  puesto: string;
  estado: 'activo' | 'baja';
  baja: { desde: string; purgaEn: string } | null;
}

const dia = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Personas del equipo: alta, baja y reactivación. Solo datos de la relación
 * laboral; nunca niveles, check-ins ni uso de la app.
 */
function TeamList({ version, onCreds }: { version: number; onCreds: (c: Record<string, string>) => void }) {
  const [data, setData] = useState<{ trabajadores: Trabajador[]; suscripcion: SubscriptionSummary } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; tipo: 'baja' | 'password' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () =>
    api<{ trabajadores: Trabajador[]; suscripcion: SubscriptionSummary }>('/admin/workers')
      .then(setData)
      .catch((e) => setError(errMsg(e)));
  useEffect(() => void load(), [version]);

  async function baja(t: Trabajador) {
    setConfirm(null);
    setError(null);
    try {
      const r = await api<{ purgaEn: string }>(`/admin/workers/${t.id}/baja`, { body: {} });
      setNotice(`Se dio de baja a ${t.nombre}. Se liberó su puesto. Sus datos se eliminan el ${dia(r.purgaEn)}.`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function restablecer(t: Trabajador) {
    setConfirm(null);
    setError(null);
    try {
      const r = await api<{ passwordTemporal: string }>(`/admin/workers/${t.id}/password`, { body: {} });
      setNotice(`Se restableció la contraseña de ${t.nombre}. Entregale en mano la temporal: al ingresar va a tener que elegir una propia.`);
      onCreds({ persona: t.nombre, passwordTemporal: r.passwordTemporal });
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function reactivar(t: Trabajador) {
    setError(null);
    try {
      const r = await api<{ credenciales: Record<string, string> }>(`/admin/workers/${t.id}/reactivar`, { body: {} });
      setNotice(`Se reactivó a ${t.nombre}. Entregá en mano el PIN y el QR nuevos; su contraseña no cambia.`);
      onCreds(r.credenciales);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const sub = data?.suscripcion;
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="label">PERSONAS</div>
        {sub && isEntitled(sub.estado) && (
          <span className="chip chip-neutral">
            {sub.puestosEnUso} DE {sub.puestos} PUESTOS EN USO
          </span>
        )}
      </div>
      {error && <div className="alert">{error}</div>}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      {data && data.trabajadores.length === 0 && <p className="muted">Todavía no hay personas dadas de alta.</p>}
      <div className="list">
        {data?.trabajadores.map((t) => (
          <div key={t.id} className="stack" style={{ gap: 10 }}>
            <div className="list-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 220px' }}>
                <div style={{ fontWeight: 600 }}>{t.nombre}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Legajo {t.legajo ?? '—'}
                  {t.puesto ? ` · ${t.puesto}` : ''}
                  {t.baja ? ` · baja el ${dia(t.baja.desde)} · datos hasta el ${dia(t.baja.purgaEn)}` : ''}
                </div>
              </div>
              {t.estado === 'activo' ? (
                <>
                  <button type="button" className="btn" style={{ minHeight: 44, fontSize: 14 }} onClick={() => (setConfirm({ id: t.id, tipo: 'password' }), setNotice(null))}>
                    Restablecer contraseña
                  </button>
                  <button type="button" className="btn btn-danger" style={{ minHeight: 44, fontSize: 14 }} onClick={() => (setConfirm({ id: t.id, tipo: 'baja' }), setNotice(null))}>
                    Dar de baja
                  </button>
                </>
              ) : (
                <>
                  <span className="chip chip-neutral">DE BAJA</span>
                  <button type="button" className="btn" style={{ minHeight: 44, fontSize: 14 }} onClick={() => void reactivar(t)}>
                    Reactivar
                  </button>
                </>
              )}
            </div>
            {confirm?.id === t.id && confirm.tipo === 'password' && (
              <div className="card elevated" style={{ padding: '18px 20px', gap: 12 }} role="alertdialog" aria-live="assertive" aria-label={`Restablecer la contraseña de ${t.nombre}`}>
                <div style={{ fontSize: 15, lineHeight: 1.55 }}>
                  ¿Restablecer la contraseña de <strong>{t.nombre}</strong>? Usalo solo si no puede recuperarla por SMS (por ejemplo, perdió el teléfono). Se cierran sus sesiones, se le avisa por
                  SMS y se genera una contraseña temporal para entregarle en mano; al ingresar tendrá que elegir una propia, que la empresa no conoce.
                </div>
                <div className="row">
                  <button type="button" className="btn btn-primary" style={{ minHeight: 48, fontSize: 15 }} onClick={() => void restablecer(t)}>
                    Sí, restablecer
                  </button>
                  <button type="button" className="btn" style={{ minHeight: 48, fontSize: 15 }} onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {confirm?.id === t.id && confirm.tipo === 'baja' && (
              <div className="card elevated" style={{ padding: '18px 20px', gap: 12 }} role="alertdialog" aria-live="assertive" aria-label={`Dar de baja a ${t.nombre}`}>
                <div style={{ fontSize: 15, lineHeight: 1.55 }}>
                  ¿Dar de baja a <strong>{t.nombre}</strong>? Se libera su puesto y se cierran sus sesiones en todos los dispositivos; su PIN y QR dejan de funcionar. Durante 30 días
                  podrá ingresar solo para descargar o eliminar sus datos; después se eliminan. La empresa no accede a esos datos en ningún momento.
                </div>
                <div className="row">
                  <button type="button" className="btn btn-danger-solid" style={{ minHeight: 48, fontSize: 15 }} onClick={() => void baja(t)}>
                    Sí, dar de baja
                  </button>
                  <button type="button" className="btn" style={{ minHeight: 48, fontSize: 15 }} onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function AdminTeam() {
  const [kiosks, setKiosks] = useState<Array<{ id: string; nombre: string; creado_en: string; revocado_en: string | null }>>([]);
  const [newKiosk, setNewKiosk] = useState('');
  const [kioskToken, setKioskToken] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [w, setW] = useState({ nombre: '', nombreCorto: '', puesto: '', dni: '', legajo: '', telefono: '', rosterInicio: new Date().toISOString().slice(0, 10), turno: 'dia' });

  const load = () =>
    api<{ kioscos: typeof kiosks }>('/admin/kiosks')
      .then((r) => setKiosks(r.kioscos))
      .catch((e) => setError(errMsg(e)));
  useEffect(() => void load(), []);

  return (
    <div className="screen">
      <h1 className="h1">Equipo y kioscos</h1>
      {error && <div className="alert">{error}</div>}
      <TeamList version={version} onCreds={setCreds} />
      {creds && (
        <div className="card elevated">
          <div className="label">CREDENCIALES · SE MUESTRAN UNA SOLA VEZ</div>
          <p className="muted" style={{ fontSize: 14 }}>
            Entregalas en mano.
          </p>
          <table className="table">
            <tbody>
              {Object.entries(creds).map(([k, v]) => (
                <tr key={k}>
                  <td className="label">{k}</td>
                  <td className="num" style={{ wordBreak: 'break-all' }}>
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="card">
        <div className="label">KIOSCOS REGISTRADOS</div>
        <div className="list">
          {kiosks.map((k) => (
            <div key={k.id} className="list-row">
              <div style={{ flex: 1 }}>{k.nombre}</div>
              {k.revocado_en ? (
                <span className="chip chip-neutral">REVOCADO</span>
              ) : (
                <button type="button" className="btn btn-danger" style={{ minHeight: 44, fontSize: 14 }} onClick={() => void api(`/admin/kiosks/${k.id}`, { method: 'DELETE' }).then(load)}>
                  Revocar
                </button>
              )}
            </div>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void api<{ token: string }>('/admin/kiosks', { body: { nombre: newKiosk } })
              .then((r) => (setKioskToken(r.token), setNewKiosk(''), load()))
              .catch((er) => setError(errMsg(er)));
          }}
        >
          <input className="input" style={{ flex: '1 1 240px' }} placeholder="Nombre del kiosco (p. ej. Comedor — Módulo 3)" value={newKiosk} onChange={(e) => setNewKiosk(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={newKiosk.length < 2}>
            Registrar kiosco
          </button>
        </form>
        {kioskToken && (
          <div className="card elevated">
            <div className="label">CÓDIGO DEL KIOSCO · SE MUESTRA UNA SOLA VEZ</div>
            <code className="num" style={{ wordBreak: 'break-all' }}>
              {kioskToken}
            </code>
            <p className="muted" style={{ fontSize: 14 }}>
              Abrí /kiosco en la tablet y pegá este código.
            </p>
          </div>
        )}
      </section>
      <section className="card">
        <div className="label">ALTA DE UNA PERSONA</div>
        <form
          className="grid"
          style={{ ['--min' as string]: '220px', gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void api<{ credenciales: Record<string, string> }>('/admin/workers', { body: { ...w, telefono: w.telefono || undefined } })
              .then((r) => (setCreds(r.credenciales), setVersion((v) => v + 1)))
              .catch((er) => setError(errMsg(er)));
          }}
        >
          {(
            [
              ['nombre', 'NOMBRE Y APELLIDO'],
              ['nombreCorto', 'CÓMO LE DECIMOS'],
              ['puesto', 'PUESTO'],
              ['dni', 'DNI'],
              ['legajo', 'LEGAJO'],
              ['telefono', 'TELÉFONO (2FA)'],
              ['rosterInicio', 'DÍA 1 DEL ROSTER'],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span className="label">{l}</span>
              <input className="input" type={k === 'rosterInicio' ? 'date' : 'text'} value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} required={k !== 'telefono' && k !== 'puesto'} />
            </label>
          ))}
          <label className="field">
            <span className="label">TURNO</span>
            <select className="input" value={w.turno} onChange={(e) => setW({ ...w, turno: e.target.value })}>
              <option value="dia">Día</option>
              <option value="noche">Noche</option>
            </select>
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button type="submit" className="btn btn-primary btn-block">
              Dar de alta
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
