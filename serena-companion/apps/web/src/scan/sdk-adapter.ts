import type { ScanAvailability, ScanListener, ScanProvider } from '@serena/domain';

/**
 * ADAPTADOR DEL SDK DE ESCANEO — PENDIENTE.
 *
 * Acá se integra el SDK de signos vitales por cámara (Shen.AI en marca blanca)
 * cuando esté disponible. La UI ya está terminada y solo consume los eventos de
 * `ScanEvent` (packages/domain/src/scan.ts). Tareas al recibir el SDK:
 *
 * 1. availability(): verificar licencia (P1: ¿funciona sin conexión?), soporte
 *    de la plataforma (P2: web y kiosco) y devolver `sin_licencia`,
 *    `no_soportado` o `sin_conexion` según corresponda.
 * 2. mountPreview(): montar la vista de cámara del SDK dentro de `container`
 *    (slot 6.6) y traducir su control de calidad a eventos `calidad`
 *    (luz, rostroCentrado, movimiento, contraluz).
 * 3. start(): iniciar la medición de `duracionS` (30–60 s) y emitir `progreso`,
 *    `metrica` (con `estable` cuando el SDK la considere estable),
 *    `senal_perdida` y finalmente `completo` con las métricas y la calidad.
 * 4. stop(): liberar cámara y memoria. Confirmar por escrito con el proveedor
 *    que no se almacenan ni transmiten imágenes (P4) antes de publicar.
 * 5. No mostrar marcas de terceros en ningún texto ni elemento visual.
 *
 * Para activarlo: VITE_SCAN_PROVIDER=sdk
 */
export class SdkScanProvider implements ScanProvider {
  readonly id = 'sdk';

  async availability(): Promise<ScanAvailability> {
    return { disponible: false, motivo: 'sin_licencia' };
  }

  async mountPreview(_container: HTMLElement, _stream: MediaStream | null, _listener: ScanListener): Promise<void> {
    throw new Error('SDK de escaneo no integrado todavía');
  }

  async start(_opts: { duracionS: number }, _listener: ScanListener): Promise<void> {
    throw new Error('SDK de escaneo no integrado todavía');
  }

  async stop(): Promise<void> {}
}
