import { SdkScanProvider } from '../sdk/proveedor.ts';
import { MARCO_VERSION, type ModuloEscaneo } from './contrato.ts';

/**
 * Entrada de la página /escaneo-marco.html: publica el módulo de escaneo para la app que la cargó en un marco.
 * Es todo lo que hay que escribir para acoplar un SDK: una función `crear` que devuelve un `ScanProvider`.
 */
const modulo: ModuloEscaneo = {
  version: MARCO_VERSION,
  motor: 'shenai-3',
  crear: (o) => new SdkScanProvider(o.escalaEstres, undefined, o.credencial, o.diagnostico),
};
window.serenaEscaneo = modulo;
