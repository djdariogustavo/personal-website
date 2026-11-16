/**
 * Panel de la organización. La empresa solo ve estadísticas anónimas de grupo
 * (k-anonimato) y gestiona el pago. Nunca ve nombres ni resultados individuales.
 *
 * Una pantalla por archivo, para corregir cada una sin tocar las demás:
 *   Estadisticas.tsx  participación y niveles por día de roster (anónimos)
 *   Facturacion.tsx   plan, medio de pago y datos de facturación
 *   OrdenCompra.tsx   orden de compra por transferencia
 *   PagoPrueba.tsx    pago simulado (solo en desarrollo)
 *   Equipo.tsx        altas, bajas y credenciales del equipo
 *   comun.ts          lo compartido
 */
export { AdminStats } from './Estadisticas.tsx';
export { AdminBilling } from './Facturacion.tsx';
export { OrdenCompraView } from './OrdenCompra.tsx';
export { SandboxCheckout } from './PagoPrueba.tsx';
export { AdminTeam } from './Equipo.tsx';
