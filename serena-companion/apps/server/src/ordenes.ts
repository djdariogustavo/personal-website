/**
 * Gestión de órdenes de compra del plan Empresa, para operadores de SERENA (no para la empresa cliente).
 * Se usa desde la consola del servidor (p. ej. la Shell de Render):
 *
 *   npm run ordenes -w @serena/server -- listar [--estado pendiente]
 *   npm run ordenes -w @serena/server -- ver OC-000001
 *   npm run ordenes -w @serena/server -- pagada OC-000001 --fecha 2026-10-12 --referencia "TRF 123456" [--factura "A-0001-00000012"]
 *   npm run ordenes -w @serena/server -- vencida OC-000001
 *   npm run ordenes -w @serena/server -- factura OC-000001 --numero "A-0001-00000012"
 *
 * "pagada" activa la suscripción de la organización y fija el próximo vencimiento (1 mes o 12 desde el pago).
 * "vencida" la pasa a pago vencido. Ninguno bloquea el botón de emergencia ni el acceso de cada persona a sus datos.
 */
import { CONDICION_IVA, ESTADO_ORDEN, formatCuit, formatMoney, type OrdenCompra } from '@serena/domain';
import { datosTransferencia, env } from './env.ts';
import { openDb } from './db.ts';
import { listarOrdenes, OrdenCompraProvider } from './payments/ordenCompra.ts';

const [comando, ...resto] = process.argv.slice(2);
const opciones = new Map<string, string>();
const posicionales: string[] = [];
for (let i = 0; i < resto.length; i++) {
  const a = resto[i]!;
  if (a.startsWith('--')) opciones.set(a.slice(2), resto[++i] ?? '');
  else posicionales.push(a);
}

const db = openDb(env.dbPath);
const transferencia = datosTransferencia();
if (!transferencia) {
  console.error('Falta SERENA_TRANSFERENCIA_JSON: sin datos para la transferencia, el plan Empresa no está habilitado.');
  process.exit(1);
}
const oc = new OrdenCompraProvider(db, { transferencia, diasPago: env.payments.ordenCompra.diasPago });
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—');
const nombreOrg = (orgId: string) => (db.prepare('SELECT nombre FROM orgs WHERE id = ?').get(orgId) as { nombre: string } | undefined)?.nombre ?? orgId;

function mostrar(o: OrdenCompra) {
  const f = o.facturacion;
  console.info(
    [
      `${o.numero} · ${ESTADO_ORDEN[o.estado]}`,
      `  ${o.planNombre} · ${o.puestos} puestos × ${formatMoney(o.precioUnitario, o.moneda)} = ${formatMoney(o.total, o.moneda)}`,
      `  ${f.razonSocial} · CUIT ${formatCuit(f.cuit)} · ${CONDICION_IVA[f.condicionIva]}`,
      `  Contacto: ${f.contactoNombre} · ${f.contactoEmail}${f.ordenInterna ? ` · OC interna ${f.ordenInterna}` : ''}`,
      `  Emitida ${fecha(o.emitidaEn)} · vence ${fecha(o.venceEn)} · pagada ${fecha(o.pagadaEn)}${o.referenciaPago ? ` (ref. ${o.referenciaPago})` : ''}`,
      `  Factura: ${o.numeroFactura ?? '—'}`,
    ].join('\n'),
  );
}

try {
  const numero = posicionales[0] ?? '';
  switch (comando) {
    case 'listar': {
      const estado = opciones.get('estado');
      const ordenes = listarOrdenes(db).filter((o) => !estado || o.estado === estado);
      if (!ordenes.length) console.info('No hay órdenes.');
      for (const o of ordenes)
        console.info(`${o.numero}  ${ESTADO_ORDEN[o.estado].padEnd(18)}  ${formatMoney(o.total, o.moneda).padStart(16)}  ${o.facturacion.razonSocial} (${nombreOrg(o.orgId)})`);
      break;
    }
    case 'ver': {
      const o = listarOrdenes(db).find((x) => x.numero.toUpperCase() === numero.toUpperCase());
      if (!o) throw new Error(`No existe la orden ${numero}.`);
      mostrar(o);
      break;
    }
    case 'pagada':
      mostrar(oc.marcarPagada(numero, { fecha: opciones.get('fecha') ?? '', referencia: opciones.get('referencia') ?? '', numeroFactura: opciones.get('factura') ?? null }));
      console.info('Suscripción activa.');
      break;
    case 'vencida':
      mostrar(oc.marcarVencida(numero));
      console.info('Suscripción en pago vencido.');
      break;
    case 'factura':
      mostrar(oc.registrarFactura(numero, opciones.get('numero') ?? ''));
      break;
    default:
      console.error('Comandos: listar | ver <OC> | pagada <OC> --fecha AAAA-MM-DD --referencia <ref> [--factura <nro>] | vencida <OC> | factura <OC> --numero <nro>');
      process.exit(1);
  }
} catch (e) {
  console.error(`No se pudo completar: ${(e as Error).message}`);
  process.exit(1);
}
