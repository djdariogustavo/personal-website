import { DEMO } from '../demo/flags.ts';
import type { RemoteConfig, ScanProvider } from '@serena/domain';
import { SimulatedScanProvider } from './simulated.ts';
import { UnavailableScanProvider } from './unavailable.ts';

/**
 * Registro del proveedor de escaneo NeuroSentinel™.
 *
 * VITE_SCAN_PROVIDER:
 *   - "ninguno"  (por defecto en producción): el escaneo figura como no disponible
 *                y el check-in sigue con autorreporte y reacción.
 *   - "simulado" (por defecto en desarrollo): valores sintéticos para probar la UI.
 *                La pantalla muestra "SIMULACIÓN · SIN SDK"; nunca usar con personas.
 *   - "sdk":      adaptador del SDK real (ver ./sdk-adapter.ts); requiere licencia y el SDK en public/vendor.
 */
export type ScanMode = 'ninguno' | 'simulado' | 'sdk';

export const scanMode: ScanMode =
  (import.meta.env.VITE_SCAN_PROVIDER as ScanMode | undefined) ?? (import.meta.env.DEV || DEMO ? 'simulado' : 'ninguno');

let instance: ScanProvider | null = null;

/** La primera llamada (paso de luz) pasa la configuración; las siguientes reciben la misma instancia. */
export async function getScanProvider(escaneo?: RemoteConfig['escaneo']): Promise<ScanProvider> {
  if (instance) return instance;
  if (scanMode === 'simulado') instance = new SimulatedScanProvider();
  else if (scanMode === 'sdk') {
    const { SdkScanProvider } = await import('./sdk-adapter.ts');
    const { getToken } = await import('../lib/api.ts');
    instance = new SdkScanProvider(escaneo?.escalaEstresSdk ?? null, undefined, undefined, (d) => {
      // Diagnóstico de campo (sin datos de la persona; el servidor agrega el navegador). `keepalive` lo entrega aunque
      // la persona cierre o recargue la página en ese momento. Si falla, se ignora: es solo diagnóstico.
      const token = getToken();
      const nav = navigator as Navigator & { deviceMemory?: number };
      const cuerpo = {
        ...d,
        memoriaGb: nav.deviceMemory,
        nucleos: nav.hardwareConcurrency,
        aislado: globalThis.crossOriginIsolated === true,
      };
      void fetch('/api/escaneo/diagnostico', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(cuerpo),
      }).catch(() => undefined);
    });
  } else instance = new UnavailableScanProvider();
  return instance;
}
