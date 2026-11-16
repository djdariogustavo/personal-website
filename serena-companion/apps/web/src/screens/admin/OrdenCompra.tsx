import { DEMO } from '../../demo/flags.ts';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CONDICION_IVA, ESTADO_ORDEN, formatCuit, formatMoney, type DatosTransferencia, type OrdenCompra } from '@serena/domain';
import { api, ApiError, getToken } from '../../lib/api.ts';
import { errMsg } from './comun.tsx';

/** Orden de compra / proforma del plan Empresa: detalle, datos para transferir y descarga en PDF. */
export function OrdenCompraView() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<{ orden: OrdenCompra; transferencia: DatosTransferencia | null; organizacion: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ orden: OrdenCompra; transferencia: DatosTransferencia | null; organizacion: string }>(`/admin/billing/ordenes/${encodeURIComponent(id)}`)
      .then(setData)
      .catch((e) => setError(errMsg(e)));
  }, [id]);

  async function descargar() {
    setError(null);
    try {
      if (DEMO) throw new ApiError(400, 'demo', 'En la vista previa no se genera el PDF. Usá "Imprimir".');
      const token = getToken();
      const r = await fetch(`/api/admin/billing/ordenes/${encodeURIComponent(id)}/pdf`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new ApiError(r.status, 'pdf', 'No se pudo descargar el PDF.');
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `SERENA-${data?.orden.numero ?? 'orden'}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (!data)
    return (
      <div className="screen narrow">
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : (
          <p className="muted">Cargando…</p>
        )}
      </div>
    );
  const { orden: o, transferencia: t } = data;
  const f = o.facturacion;
  const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-AR') : '—');
  const periodo = o.intervalo === 'anual' ? 'año' : 'mes';
  return (
    <div className="screen narrow">
      <div className="stack">
        <div className="label cyan">ORDEN DE COMPRA / PROFORMA</div>
        <h1 className="h1 num">{o.numero}</h1>
        <span className="chip chip-neutral" style={{ alignSelf: 'flex-start' }}>
          {ESTADO_ORDEN[o.estado]}
        </span>
      </div>
      <div className="card">
        <div className="label">DETALLE</div>
        <div>
          {o.planNombre} · <span className="num">{o.puestos}</span> puestos × <span className="num">{formatMoney(o.precioUnitario, o.moneda)}</span> por puesto por {periodo}
        </div>
        <div style={{ fontSize: 18 }}>
          Total por {periodo}: <strong className="num">{formatMoney(o.total, o.moneda)}</strong>
        </div>
        {o.periodoDesde && <div className="meta">Renovación del período que empieza el {fecha(o.periodoDesde)}</div>}
        <div className="meta">
          Emitida el {fecha(o.emitidaEn)} · vence el {fecha(o.venceEn)}
          {o.pagadaEn ? ` · pagada el ${fecha(o.pagadaEn)}` : ''}
          {o.numeroFactura ? ` · factura ${o.numeroFactura}` : ''}
        </div>
      </div>
      <div className="card">
        <div className="label">CLIENTE</div>
        <div>
          {f.razonSocial} · CUIT <span className="num">{formatCuit(f.cuit)}</span> · {CONDICION_IVA[f.condicionIva]}
        </div>
        <div>{f.domicilioFiscal}</div>
        <div className="meta">
          Compras: {f.contactoNombre} · {f.contactoEmail}
          {f.ordenInterna ? ` · OC interna ${f.ordenInterna}` : ''}
        </div>
      </div>
      {t && o.estado === 'pendiente' && (
        <div className="card">
          <div className="label">DATOS PARA LA TRANSFERENCIA</div>
          {t.ejemplo && <div className="warn-text">Datos de ejemplo: no transferir. Falta configurar SERENA_TRANSFERENCIA_JSON en el servidor.</div>}
          <div>
            {t.titular} · CUIT <span className="num">{formatCuit(t.cuit)}</span>
          </div>
          <div>{t.banco}</div>
          <div>
            CBU <span className="num">{t.cbu}</span>
            {t.alias ? ` · Alias ${t.alias}` : ''}
          </div>
          <div className="meta">
            Indicá {o.numero} como referencia
            {t.email ? (
              <>
                {' '}y enviá el comprobante a <a href={`mailto:${t.email}`}>{t.email}</a>
              </>
            ) : null}
            . Los puestos ya están habilitados; la suscripción se activa cuando SERENA confirme el pago.
          </div>
        </div>
      )}
      {error && <div className="alert">{error}</div>}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => void descargar()}>
          Descargar PDF
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          Imprimir
        </button>
        <button type="button" className="btn" onClick={() => nav('/admin/facturacion')}>
          Volver a Facturación
        </button>
      </div>
    </div>
  );
}
