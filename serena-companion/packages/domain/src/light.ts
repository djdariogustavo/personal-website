/**
 * Verificación de luz y encuadre (anexo técnico, "Verificación de luz").
 *
 * Control (2), válido en todos los dispositivos: luminancia media sobre la
 * región del rostro (el óvalo guía) calculada sobre los cuadros de la cámara,
 * más detección de contraluz (fondo mucho más brillante que el rostro) y de
 * movimiento (diferencia entre cuadros). Control (1), sensor de luz ambiente,
 * se combina cuando existe. Todo corre en el dispositivo; ningún cuadro sale de
 * la memoria del navegador.
 *
 * Funciones puras sobre buffers RGBA para poder testearlas.
 */
import type { LightThresholds } from './config.ts';
import type { LightLevel } from './scan.ts';

export interface FrameStats {
  /** Luminancia media dentro del óvalo, 0–255. */
  rostro: number;
  /** Luminancia media fuera del óvalo, 0–255. */
  fondo: number;
  /** Luminancia en escala reducida para comparar con el cuadro siguiente. */
  miniatura: Uint8Array;
}

/** Luma BT.601. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Óvalo guía en coordenadas normalizadas, igual al dibujado en pantalla
 * (centro 50 % / 41 %, semiejes 26 % × 29 % del cuadro).
 */
export const OVAL = { cx: 0.5, cy: 0.41, rx: 0.26, ry: 0.29 } as const;

export function frameStats(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, miniSize = 16): FrameStats {
  let sumIn = 0;
  let nIn = 0;
  let sumOut = 0;
  let nOut = 0;
  const mini = new Uint8Array(miniSize * miniSize);
  const miniSum = new Float64Array(miniSize * miniSize);
  const miniN = new Uint32Array(miniSize * miniSize);
  // Muestreo cada 2 píxeles: suficiente para promedios y 4× más rápido.
  for (let y = 0; y < height; y += 2) {
    const ny = y / height;
    const dy = (ny - OVAL.cy) / OVAL.ry;
    const my = Math.min(miniSize - 1, Math.floor(ny * miniSize));
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const l = luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
      const nx = x / width;
      const dx = (nx - OVAL.cx) / OVAL.rx;
      if (dx * dx + dy * dy <= 1) {
        sumIn += l;
        nIn++;
      } else {
        sumOut += l;
        nOut++;
      }
      const mi = my * miniSize + Math.min(miniSize - 1, Math.floor(nx * miniSize));
      miniSum[mi]! += l;
      miniN[mi]!++;
    }
  }
  for (let i = 0; i < mini.length; i++) mini[i] = miniN[i] ? Math.round(miniSum[i]! / miniN[i]!) : 0;
  return { rostro: nIn ? sumIn / nIn : 0, fondo: nOut ? sumOut / nOut : 0, miniatura: mini };
}

export function motionBetween(a: Uint8Array | null, b: Uint8Array): number {
  if (!a || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return s / a.length;
}

export interface LightAssessment {
  luz: LightLevel;
  contraluz: boolean;
  movimiento: boolean;
}

export function assessLight(
  stats: { rostro: number; fondo: number },
  motion: number,
  t: LightThresholds,
  ambientLux?: number | null,
): LightAssessment {
  const contraluz = stats.rostro > 0 && stats.fondo / Math.max(stats.rostro, 1) >= t.contraluzRatio;
  let luz: LightLevel;
  if (stats.rostro < t.insuficienteBajo) luz = 'insuficiente';
  else if (stats.rostro < t.justaBajo || stats.rostro > t.sobreexpuesta) luz = 'justa';
  else luz = 'optima';

  // Contraluz fuerte degrada un nivel: el rostro queda subexpuesto aunque la media sea alta.
  if (contraluz) luz = luz === 'optima' ? 'justa' : 'insuficiente';

  // Sensor de luz ambiente (Android/tablets industriales): nunca mejora el
  // resultado de la cámara, solo lo puede empeorar.
  if (ambientLux !== undefined && ambientLux !== null) {
    if (ambientLux < t.luxInsuficiente) luz = 'insuficiente';
    else if (ambientLux < t.luxJusta && luz === 'optima') luz = 'justa';
  }

  return { luz, contraluz, movimiento: motion >= t.movimiento };
}

export const LIGHT_COPY: Record<LightLevel, { etiqueta: string; mensaje: string; segmentos: 1 | 2 | 3 }> = {
  insuficiente: {
    etiqueta: 'LUZ INSUFICIENTE',
    mensaje: 'Hay poca luz para medir bien. Acercate a una lámpara o mirá hacia una ventana.',
    segmentos: 1,
  },
  justa: { etiqueta: 'LUZ JUSTA', mensaje: 'Casi. Si podés, sumá un poco de luz de frente.', segmentos: 2 },
  optima: { etiqueta: 'LUZ ÓPTIMA', mensaje: 'Perfecto. Mantené la cara dentro del óvalo.', segmentos: 3 },
};
