import type { ScanAvailability, ScanProvider } from '@serena/domain';

/** Proveedor vacío mientras no está el SDK: la UI ofrece el check-in sin escaneo. */
export class UnavailableScanProvider implements ScanProvider {
  readonly id = 'ninguno';
  async availability(): Promise<ScanAvailability> {
    return { disponible: false, motivo: 'no_soportado' };
  }
  async mountPreview() {}
  async start() {
    throw new Error('Escaneo no disponible');
  }
  async stop() {}
}
