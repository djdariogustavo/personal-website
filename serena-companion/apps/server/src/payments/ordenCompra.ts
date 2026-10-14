import { randomUUID } from 'node:crypto';
import {
  CONDICION_IVA,
  ESTADO_ORDEN,
  formatCuit,
  formatMoney,
  type DatosFacturacion,
  type DatosTransferencia,
  type EstadoOrden,
  type OrdenCompra,
} from '@serena/domain';
import { nowIso, tx, type DB } from '../db.ts';
import { generarPdf, type BloquePdf } from '../pdf.ts';
import { applyPaymentEvent } from './index.ts';
import type { CheckoutInput, CheckoutOutput, NormalizedPaymentEvent, PaymentProvider } from './types.ts';

/**
 * Plan Empresa por orden de compra y transferencia bancaria, sin pasarela de pago.
 *
 * Al contratar se emite una orden / proforma con número correlativo (OC-000001…), el detalle, el total y los datos
 * para transferir. La suscripción queda en "orden_pendiente", con los puestos habilitados. Un operador de SERENA
 * (no la administración de la empresa) registra el pago desde la consola del servidor (npm run ordenes), lo que
 * activa la suscripción y fija el próximo vencimiento; o la marca vencida. La factura se emite fuera de la app
 * (sin integración con AFIP) y su número se registra en la orden.
 */

export interface ConfigOrdenCompra {
  transferencia: DatosTransferencia;
  /** Días para pagar la orden desde su emisión. */
  diasPago: number;
  /** Envía la orden por email (con el PDF) al contacto de compras y a operaciones. No debe lanzar. */
  notificar?: (orden: OrdenCompra, pdf: Buffer, organizacion: string) => Promise<void>;
}

interface FilaOrden {
  id: string;
  numero: number;
  org_id: string;
  plan_id: string;
  plan_nombre: string;
  intervalo: 'mensual' | 'anual';
  puestos: number;
  moneda: string;
  precio_unitario: number;
  total: number;
  facturacion: string;
  estado: EstadoOrden;
  emitida_en: string;
  vence_en: string;
  pagada_en: string | null;
  referencia_pago: string | null;
  numero_factura: string | null;
}

export const numeroOrden = (n: number) => `OC-${String(n).padStart(6, '0')}`;

function aOrden(f: FilaOrden): OrdenCompra {
  return {
    id: f.id,
    numero: numeroOrden(f.numero),
    estado: f.estado,
    planId: f.plan_id,
    planNombre: f.plan_nombre,
    intervalo: f.intervalo,
    puestos: f.puestos,
    moneda: f.moneda,
    precioUnitario: f.precio_unitario,
    total: f.total,
    facturacion: JSON.parse(f.facturacion) as DatosFacturacion,
    emitidaEn: f.emitida_en,
    venceEn: f.vence_en,
    pagadaEn: f.pagada_en,
    referenciaPago: f.referencia_pago,
    numeroFactura: f.numero_factura,
  };
}

export function obtenerOrden(db: DB, id: string, orgId?: string): OrdenCompra | null {
  const f = (orgId
    ? db.prepare('SELECT * FROM ordenes_compra WHERE id = ? AND org_id = ?').get(id, orgId)
    : db.prepare('SELECT * FROM ordenes_compra WHERE id = ?').get(id)) as FilaOrden | undefined;
  return f ? aOrden(f) : null;
}

/**
 * Cierra las suscripciones por orden de compra que la empresa canceló y cuyo período pagado ya terminó. Con una
 * pasarela lo hace el aviso del proveedor; acá no hay proveedor que avise, así que corre cada hora en el servidor.
 * Solo toca las canceladas por la empresa: un período vencido sin pagar lo marca el operador (`ordenes vencida`),
 * porque una transferencia suele acreditarse con días de demora.
 */
export function cerrarCanceladasVencidas(db: DB, ahora = new Date()): number {
  return Number(
    db
      .prepare(
        `UPDATE subscriptions SET estado = 'cancelada', actualizada_en = ?
         WHERE proveedor = 'orden_compra' AND cancelada_al_final = 1 AND estado IN ('activa', 'pago_vencido')
           AND proximo_cobro IS NOT NULL AND proximo_cobro <= ?`,
      )
      .run(nowIso(), ahora.toISOString()).changes,
  );
}

export function listarOrdenes(db: DB, orgId?: string): Array<OrdenCompra & { orgId: string }> {
  const filas = (orgId
    ? db.prepare('SELECT * FROM ordenes_compra WHERE org_id = ? ORDER BY numero DESC').all(orgId)
    : db.prepare('SELECT * FROM ordenes_compra ORDER BY numero DESC').all()) as unknown as FilaOrden[];
  return filas.map((f) => ({ ...aOrden(f), orgId: f.org_id }));
}

function filaPorNumero(db: DB, numero: string): FilaOrden {
  const n = Number(numero.replace(/^OC-/i, ''));
  const f = Number.isInteger(n) ? (db.prepare('SELECT * FROM ordenes_compra WHERE numero = ?').get(n) as FilaOrden | undefined) : undefined;
  if (!f) throw new Error(`No existe la orden ${numero}.`);
  return f;
}

const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

/** Contenido de la orden / proforma, compartido por el PDF y el email. */
export function bloquesProforma(o: OrdenCompra, t: DatosTransferencia, organizacion: string): BloquePdf[] {
  const f = o.facturacion;
  const periodo = o.intervalo === 'anual' ? 'año' : 'mes';
  return [
    { texto: 'SERENA Companion', tam: 18, negrita: true },
    { texto: `Orden de compra / Proforma ${o.numero}`, tam: 13, negrita: true, antes: 4 },
    { texto: `Emitida el ${fechaCorta(o.emitidaEn)} · Vence el ${fechaCorta(o.venceEn)} · Estado: ${ESTADO_ORDEN[o.estado]}` },
    { texto: 'Documento no válido como factura. La factura se emite por separado según la condición frente al IVA.', tam: 8 },
    { separador: true },
    { texto: 'Emisor', negrita: true },
    { texto: `${t.titular} · CUIT ${formatCuit(t.cuit)}` },
    { texto: 'Cliente', negrita: true, antes: 6 },
    { texto: `${f.razonSocial} · CUIT ${formatCuit(f.cuit)} · ${CONDICION_IVA[f.condicionIva]}` },
    { texto: `Domicilio fiscal: ${f.domicilioFiscal}` },
    { texto: `Organización en SERENA: ${organizacion}` },
    { texto: `Contacto de compras: ${f.contactoNombre} · ${f.contactoEmail}${f.contactoTelefono ? ` · ${f.contactoTelefono}` : ''}` },
    ...(f.ordenInterna ? [{ texto: `Orden de compra interna del cliente: ${f.ordenInterna}` }] : []),
    { separador: true },
    { texto: 'Detalle', negrita: true },
    { texto: `${o.planNombre} · ${o.puestos} puestos × ${formatMoney(o.precioUnitario, o.moneda)} por puesto por ${periodo}` },
    { texto: `Total por ${periodo}: ${formatMoney(o.total, o.moneda)}`, tam: 12, negrita: true, antes: 4 },
    { separador: true },
    { texto: 'Datos para la transferencia', negrita: true },
    ...(t.ejemplo ? [{ texto: 'DATOS DE EJEMPLO: no transferir. El operador de SERENA debe configurar SERENA_TRANSFERENCIA_JSON.', negrita: true }] : []),
    { texto: `Titular: ${t.titular} · CUIT ${formatCuit(t.cuit)}` },
    { texto: `Banco: ${t.banco}` },
    { texto: `CBU: ${t.cbu}${t.alias ? ` · Alias: ${t.alias}` : ''}` },
    { texto: `Indicar ${o.numero} como referencia de la transferencia y enviar el comprobante ${t.email ? `a ${t.email}` : 'al contacto de SERENA'}.`, antes: 4 },
    { texto: 'Los puestos quedan habilitados desde la emisión de esta orden. El estado del pago nunca bloquea el botón de emergencia ni el acceso de cada persona a sus datos.', tam: 8, antes: 8 },
  ];
}

export function pdfOrden(o: OrdenCompra, t: DatosTransferencia, organizacion: string): Buffer {
  return generarPdf(bloquesProforma(o, t, organizacion), `Orden de compra ${o.numero}`);
}

export function textoProforma(o: OrdenCompra, t: DatosTransferencia, organizacion: string): string {
  return bloquesProforma(o, t, organizacion)
    .map((b) => ('separador' in b ? '' : b.texto))
    .join('\n');
}

function sumarMeses(iso: string, meses: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString();
}

export class OrdenCompraProvider implements PaymentProvider {
  readonly id = 'orden_compra' as const;
  readonly nombre = 'Orden de compra (transferencia)';
  readonly monedas = ['ARS'];
  readonly requiereFacturacion = true;

  constructor(
    private readonly db: DB,
    readonly cfg: ConfigOrdenCompra,
  ) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutOutput> {
    if (!input.facturacion) throw new Error('La orden de compra requiere los datos de facturación.');
    const unit = input.plan.precioPorPuesto[input.moneda as 'ARS'];
    if (unit === undefined) throw new Error(`El plan ${input.plan.id} no tiene precio en ${input.moneda}`);
    const id = randomUUID();
    const ahora = nowIso();
    const venceEn = new Date(Date.now() + this.cfg.diasPago * 86_400_000).toISOString();
    tx(this.db, () => {
      const n = (this.db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM ordenes_compra').get() as { n: number }).n;
      this.db
        .prepare(
          `INSERT INTO ordenes_compra (id, numero, org_id, checkout_id, plan_id, plan_nombre, intervalo, puestos, moneda, precio_unitario, total,
            facturacion, estado, emitida_en, vence_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
        )
        .run(
          id,
          n,
          input.org.id,
          input.checkoutId,
          input.plan.id,
          input.plan.nombre,
          input.plan.intervalo,
          input.puestos,
          input.moneda,
          unit,
          unit * input.puestos,
          JSON.stringify(input.facturacion),
          ahora,
          venceEn,
          ahora,
        );
    });
    const orden = obtenerOrden(this.db, id)!;
    // El email no bloquea ni hace fallar la emisión: la orden queda disponible en la app y en PDF.
    if (this.cfg.notificar) void this.cfg.notificar(orden, pdfOrden(orden, this.cfg.transferencia, input.org.nombre), input.org.nombre).catch(() => undefined);
    return { url: `/admin/facturacion/orden/${id}`, externoId: id, estadoInicial: 'orden_pendiente' };
  }

  /** La orden de compra no tiene webhooks: el pago lo registra un operador de SERENA. */
  async parseWebhook(): Promise<NormalizedPaymentEvent | null> {
    return null;
  }

  /**
   * Cancelar desde la app anula la orden si todavía no se pagó (cancelación inmediata). Si ya se pagó, la
   * suscripción sigue hasta el final del período abonado.
   */
  async cancel(externoSuscripcion: string): Promise<{ inmediata: boolean }> {
    const r = this.db
      .prepare("UPDATE ordenes_compra SET estado = 'anulada', actualizada_en = ? WHERE id = ? AND estado = 'pendiente'")
      .run(nowIso(), externoSuscripcion);
    return { inmediata: r.changes > 0 };
  }

  /** Operador de SERENA: registra la transferencia; activa la suscripción y fija el próximo vencimiento. */
  marcarPagada(numero: string, pago: { fecha: string; referencia: string; numeroFactura?: string | null }): OrdenCompra {
    const f = filaPorNumero(this.db, numero);
    if (f.estado === 'anulada') throw new Error(`La orden ${numeroOrden(f.numero)} está anulada.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pago.fecha)) throw new Error('La fecha del pago va como AAAA-MM-DD.');
    if (!pago.referencia.trim()) throw new Error('Falta la referencia de la transferencia.');
    const pagadaEn = new Date(`${pago.fecha}T12:00:00-03:00`).toISOString();
    this.db
      .prepare(
        "UPDATE ordenes_compra SET estado = 'pagada', pagada_en = ?, referencia_pago = ?, numero_factura = COALESCE(?, numero_factura), actualizada_en = ? WHERE id = ?",
      )
      .run(pagadaEn, pago.referencia.trim(), pago.numeroFactura?.trim() || null, nowIso(), f.id);
    applyPaymentEvent(this.db, this.id, {
      eventoId: `${f.id}:pagada:${pago.referencia.trim()}`,
      tipo: 'orden.pagada',
      orgId: f.org_id,
      cambios: {
        estado: 'activa',
        externoSuscripcion: f.id,
        puestos: f.puestos,
        proximoCobro: sumarMeses(pagadaEn, f.intervalo === 'anual' ? 12 : 1),
        canceladaAlFinal: false,
      },
    });
    return obtenerOrden(this.db, f.id)!;
  }

  /** Operador de SERENA: la orden no se pagó a tiempo; la suscripción pasa a pago vencido. */
  marcarVencida(numero: string): OrdenCompra {
    const f = filaPorNumero(this.db, numero);
    if (f.estado !== 'pendiente') throw new Error(`La orden ${numeroOrden(f.numero)} no está pendiente (${ESTADO_ORDEN[f.estado]}).`);
    this.db.prepare("UPDATE ordenes_compra SET estado = 'vencida', actualizada_en = ? WHERE id = ?").run(nowIso(), f.id);
    applyPaymentEvent(this.db, this.id, { eventoId: `${f.id}:vencida`, tipo: 'orden.vencida', orgId: f.org_id, cambios: { estado: 'pago_vencido', externoSuscripcion: f.id } });
    return obtenerOrden(this.db, f.id)!;
  }

  /** Operador de SERENA: número de la factura emitida fuera de la app. */
  registrarFactura(numero: string, numeroFactura: string): OrdenCompra {
    const f = filaPorNumero(this.db, numero);
    if (!numeroFactura.trim()) throw new Error('Falta el número de factura.');
    this.db.prepare('UPDATE ordenes_compra SET numero_factura = ?, actualizada_en = ? WHERE id = ?').run(numeroFactura.trim(), nowIso(), f.id);
    return obtenerOrden(this.db, f.id)!;
  }
}
