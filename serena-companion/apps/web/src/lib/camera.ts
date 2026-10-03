import { assessLight, frameStats, motionBetween, type LightAssessment, type LightThresholds, type ScanErrorCode } from '@serena/domain';

/**
 * Cámara frontal y verificación de luz en el dispositivo.
 * Los cuadros se leen en un canvas chico en memoria y se descartan: no se
 * guardan, no se envían y no se conservan entre mediciones.
 */

export async function openFrontCamera(): Promise<{ stream: MediaStream } | { error: ScanErrorCode }> {
  if (!navigator.mediaDevices?.getUserMedia) return { error: 'no_soportado' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 800 } },
      audio: false,
    });
    return { stream };
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return { error: 'sin_permiso' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return { error: 'sin_camara' };
    return { error: 'no_soportado' };
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

interface AmbientLightSensorLike extends EventTarget {
  illuminance?: number;
  start(): void;
  stop(): void;
}

export class LightMonitor {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  private prevMini: Uint8Array | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sensor: AmbientLightSensorLike | null = null;
  private lux: number | null = null;
  private history: LightAssessment[] = [];

  constructor(
    private video: HTMLVideoElement,
    private thresholds: LightThresholds,
    private onChange: (a: LightAssessment) => void,
  ) {
    this.canvas.width = 96;
    this.canvas.height = 120;
  }

  start() {
    // Control (1): sensor de luz ambiente, donde el navegador lo expone (Android/Chrome con permiso).
    const ALS = (window as unknown as { AmbientLightSensor?: new () => AmbientLightSensorLike }).AmbientLightSensor;
    if (ALS) {
      try {
        this.sensor = new ALS();
        this.sensor.addEventListener('reading', () => (this.lux = this.sensor?.illuminance ?? null));
        this.sensor.addEventListener('error', () => (this.lux = null));
        this.sensor.start();
      } catch {
        this.sensor = null;
      }
    }
    // Control (2): luminancia sobre la región del rostro + contraluz + movimiento.
    this.timer = setInterval(() => this.sample(), 300);
  }

  private sample() {
    const v = this.video;
    if (!this.ctx || v.readyState < 2 || !v.videoWidth) return;
    // Recorte centrado con la proporción 4:5 de la vista (igual al óvalo en pantalla).
    const target = 4 / 5;
    let sw = v.videoWidth;
    let sh = v.videoHeight;
    if (sw / sh > target) sw = sh * target;
    else sh = sw / target;
    const sx = (v.videoWidth - sw) / 2;
    const sy = (v.videoHeight - sh) / 2;
    this.ctx.drawImage(v, sx, sy, sw, sh, 0, 0, this.canvas.width, this.canvas.height);
    const img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const st = frameStats(img.data, img.width, img.height);
    const motion = motionBetween(this.prevMini, st.miniatura);
    this.prevMini = st.miniatura;
    const a = assessLight(st, motion, this.thresholds, this.lux);
    // Suavizado: se informa el estado que se repite en las últimas 3 lecturas (evita parpadeos).
    this.history = [...this.history.slice(-2), a];
    const counts = new Map<string, number>();
    for (const h of this.history) counts.set(h.luz, (counts.get(h.luz) ?? 0) + 1);
    const luz = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]![0] as LightAssessment['luz'];
    this.onChange({ luz, contraluz: a.contraluz, movimiento: a.movimiento });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.sensor?.stop();
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.prevMini = null;
  }
}
