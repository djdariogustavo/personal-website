import type { ScanAvailability, ScanListener, ScanMetrics, ScanProvider } from '@serena/domain';

/**
 * Proveedor SIMULADO para desarrollo y demostraciones. Emite exactamente los
 * eventos del contrato, con tiempos parecidos a los del prototipo (los
 * indicadores se estabilizan a los 6/14/20/28 s de 45 s). Los valores son
 * sintéticos y NO provienen de ninguna medición.
 */
export class SimulatedScanProvider implements ScanProvider {
  readonly id = 'simulado';
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  async availability(): Promise<ScanAvailability> {
    return { disponible: true };
  }

  async mountPreview(_c: HTMLElement, _s: MediaStream | null, listener: ScanListener) {
    listener({ type: 'calidad', luz: 'optima', rostroCentrado: true, movimiento: false, contraluz: false });
  }

  async start(opts: { duracionS: number }, listener: ScanListener) {
    await this.stop();
    const d = opts.duracionS;
    const r = Math.random();
    const estres = Math.round((1.6 + r * 2.2) * 10) / 10;
    const m: ScanMetrics = {
      pulso: Math.round(64 + estres * 4 + Math.random() * 6),
      hrv: Math.round(70 - estres * 9 + Math.random() * 6),
      respiracion: Math.round(12 + estres * 0.9),
      estres,
    };
    const at = (s: number, fn: () => void) => this.timers.push(setTimeout(fn, s * 1000));
    for (let s = 1; s <= d; s++) at(s, () => listener({ type: 'progreso', valor: s / d }));
    const k = d / 45;
    at(6 * k, () => listener({ type: 'metrica', nombre: 'pulso', valor: m.pulso, estable: true }));
    at(14 * k, () => listener({ type: 'metrica', nombre: 'hrv', valor: m.hrv, estable: true }));
    at(20 * k, () => listener({ type: 'metrica', nombre: 'respiracion', valor: m.respiracion, estable: true }));
    at(28 * k, () => listener({ type: 'metrica', nombre: 'estres', valor: m.estres, estable: true }));
    at(d + 0.2, () => listener({ type: 'completo', resultado: { metricas: m, calidad: 0.9, duracionS: d } }));
  }

  async stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
