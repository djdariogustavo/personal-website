import { DEMO } from '../demo/flags.ts';
import type { ScanProvider } from '@serena/domain';
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
 *   - "sdk":      adaptador del SDK real (ver ./sdk-adapter.ts), cuando llegue.
 */
export type ScanMode = 'ninguno' | 'simulado' | 'sdk';

export const scanMode: ScanMode =
  (import.meta.env.VITE_SCAN_PROVIDER as ScanMode | undefined) ?? (import.meta.env.DEV || DEMO ? 'simulado' : 'ninguno');

let instance: ScanProvider | null = null;

export async function getScanProvider(): Promise<ScanProvider> {
  if (instance) return instance;
  if (scanMode === 'simulado') instance = new SimulatedScanProvider();
  else if (scanMode === 'sdk') {
    const { SdkScanProvider } = await import('./sdk-adapter.ts');
    instance = new SdkScanProvider();
  } else instance = new UnavailableScanProvider();
  return instance;
}
