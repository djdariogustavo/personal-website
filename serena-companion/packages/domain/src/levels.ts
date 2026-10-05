/**
 * Clasificación del resultado del check-in en bajo / moderado / alto.
 *
 * IMPORTANTE: los umbrales son provisorios y se calibran en el trial de 30 días
 * (ver LevelThresholds en config.ts). La regla es deliberadamente simple y
 * auditable: no es un diagnóstico, es un criterio para sugerir una pausa o
 * acercar a la persona a la guardia.
 */
import type { Level, MoodIndex, ReactionResult, ScanResult, SleepIndex } from './types.ts';
import type { LevelThresholds } from './config.ts';

export interface LevelInput {
  animo: MoodIndex | null;
  sueno: SleepIndex | null;
  escaneo: ScanResult | null;
  reaccion: ReactionResult | null;
}

/** Puntaje de fatiga autorreportada normalizado 0 (bien) – 1 (muy cansado, sin dormir). */
export function selfReportScore(animo: MoodIndex | null, sueno: SleepIndex | null): number | null {
  const parts: number[] = [];
  if (animo !== null) parts.push(animo / 4);
  // Sueño: <4 h = 1, 4–6 h = 0.66, 6–8 h = 0.2, >8 h = 0
  if (sueno !== null) parts.push([1, 0.66, 0.2, 0][sueno] ?? 0);
  if (parts.length === 0) return null;
  // El ánimo pesa el doble que el sueño declarado.
  if (parts.length === 2) return (parts[0]! * 2 + parts[1]!) / 3;
  return parts[0]!;
}

const RANK: Record<Level, number> = { bajo: 0, moderado: 1, alto: 2 };
const max = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);

export function classify(input: LevelInput, t: LevelThresholds): Level {
  let level: Level = 'bajo';

  const sr = selfReportScore(input.animo, input.sueno);
  if (sr !== null) {
    if (sr >= 0.9 && t.autorreportePuedeSerAlto) level = max(level, 'alto');
    else if (sr >= t.autorreporteModerado) level = max(level, 'moderado');
  }

  if (input.escaneo) {
    const e = input.escaneo.metricas.estres;
    if (e >= t.estresAlto) level = max(level, 'alto');
    else if (e >= t.estresModerado) level = max(level, 'moderado');
  }

  if (input.reaccion && input.reaccion.toques > 0 && input.reaccion.mediaMs >= t.reaccionLentaMs) {
    level = max(level, 'moderado');
  }

  return level;
}

export const LEVEL_COPY: Record<Level, { chip: string; titulo: string; historial: string }> = {
  bajo: { chip: 'TODO EN ORDEN', titulo: 'Estás en buen ritmo.', historial: 'Bien' },
  moderado: {
    chip: 'TE CONVIENE UNA PAUSA',
    titulo: 'Tu cuerpo está pidiendo un respiro.',
    historial: 'Moderado',
  },
  alto: { chip: 'ACOMPAÑAMIENTO', titulo: 'No tenés que atravesar esto solo.', historial: 'Alto' },
};

/** Formatea números con coma decimal (es-AR). */
export function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
