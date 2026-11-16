import type { ScanProvider } from '@serena/domain';
import type { EscalaEstres } from '../shenai-map.ts';
import type { InformarDiagnostico } from '../sdk/diagnostico.ts';
import type { CredencialEscaneo } from '../sdk/inicio.ts';

/**
 * Contrato entre la app y el módulo de escaneo en marco (iframe).
 *
 * El SDK de escaneo vive en una página aparte (/escaneo-marco.html) que la app carga en un marco oculto del mismo
 * origen. Esa página publica un único objeto, `window.serenaEscaneo`, y la app lo usa a través de MarcoScanProvider
 * (./proveedor.ts). Para acoplar otro SDK alcanza con otra página que publique este mismo contrato: ninguna pantalla
 * cambia.
 *
 * Por qué un marco:
 *   - Seguridad: el SDK necesita `unsafe-eval` en la política de contenido (CSP). Con el marco, ese permiso queda
 *     solo en la página del SDK y la app (sesión, datos de salud) funciona sin él.
 *   - Recuperación: si el SDK se traba o falla, se descarta el marco y el siguiente intento arranca con un SDK
 *     nuevo (reinicializarlo en la misma página no respondía).
 *   - Memoria: al terminar la medición se descarta el marco y se liberan el motor (~36 MB) y sus modelos.
 *
 * La cámara la abre la app y se la pasa al módulo como objeto (por eso el marco es del mismo origen); las métricas
 * vuelven como eventos `ScanEvent`. La credencial y el diagnóstico los resuelve la app: el módulo no conoce la sesión.
 */
export const MARCO_URL = '/escaneo-marco.html';
/** Sube cuando cambia este contrato de forma incompatible: la app no usa un módulo de otra versión. */
export const MARCO_VERSION = 1;

export interface OpcionesModuloEscaneo {
  escalaEstres: EscalaEstres | null;
  credencial: CredencialEscaneo;
  diagnostico: InformarDiagnostico;
}

export interface ModuloEscaneo {
  version: number;
  /** Nombre interno del SDK alojado (para el diagnóstico; nunca se muestra a la persona). */
  motor: string;
  crear(opciones: OpcionesModuloEscaneo): ProveedorEnMarco;
}

/** El proveedor que publica el módulo: un `ScanProvider` que además sabe apagarse antes de que se descarte su marco. */
export interface ProveedorEnMarco extends ScanProvider {
  /** Apaga el SDK y suelta sus recursos. Después de esto el marco se descarta. */
  liberar(): Promise<void>;
}

declare global {
  interface Window {
    serenaEscaneo?: ModuloEscaneo;
  }
}
