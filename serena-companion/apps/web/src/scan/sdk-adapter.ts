/**
 * Adaptador del SDK de escaneo. El código está en ./sdk/ (una unidad por responsabilidad; ver ./sdk/proveedor.ts);
 * este archivo conserva el punto de entrada de siempre.
 */
export { SdkScanProvider } from './sdk/proveedor.ts';
export { CARGA_TOPE_MS, INIT_TOPE_MS, type CredencialEscaneo } from './sdk/inicio.ts';
export { ARRANQUE_REINTENTO_MS, ARRANQUE_TOPE_MS } from './sdk/medicion.ts';
export { detalleError, type DiagnosticoInicio, type EtapaInicio } from './sdk/diagnostico.ts';
