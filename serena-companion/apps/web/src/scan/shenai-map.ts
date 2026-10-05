import type { LightLevel, QualityEvent, ScanMetrics, SignalLostEvent } from '@serena/domain';

/**
 * Traducción pura (sin SDK ni DOM) entre el SDK de escaneo y el contrato de SERENA. Está separada del adaptador
 * para poder probarla sin la licencia. Los nombres son los de los enums del SDK (index.d.ts del paquete web 3.x).
 */

export type CondicionSdk =
  | 'FACE_POSITION'
  | 'FOREHEAD_VISIBLE'
  | 'GLASSES_NOT_DETECTED'
  | 'SUFFICIENT_LIGHT_LEVEL'
  | 'EVEN_LIGHTING'
  | 'NO_BACKLIGHT'
  | 'FACE_STABLE'
  | 'DEVICE_STABLE';

export type EstadoMedicionSdk =
  | 'NOT_STARTED'
  | 'WAITING_FOR_FACE'
  | 'RUNNING_SIGNAL_SHORT'
  | 'RUNNING_SIGNAL_GOOD'
  | 'RUNNING_SIGNAL_BAD'
  | 'RUNNING_SIGNAL_BAD_DEVICE_UNSTABLE'
  | 'FINALIZING'
  | 'FINISHED'
  | 'FAILED';

/** Subconjunto de los resultados del SDK que usa SERENA. */
export interface ResultadosSdk {
  heart_rate_bpm: number | null;
  hrv_sdnn_ms: number | null;
  breathing_rate_bpm: number | null;
  stress_index: number | null;
  average_signal_quality: number | null;
}

/**
 * Rango del índice de estrés del SDK, para llevarlo a la escala 1–5 de SERENA. No está documentado en el paquete:
 * se confirma con el proveedor y se carga en la configuración remota (escaneo.escalaEstresSdk). Sin él no se usa el
 * estrés del SDK, porque decide el nivel de riesgo y el aviso a la guardia.
 */
export interface EscalaEstres {
  min: number;
  max: number;
}

/** Condición del entorno que el SDK informa como incumplida → evento `calidad` de SERENA. */
export function calidadDesdeSdk(condicion: CondicionSdk | null, rostroOk: boolean): QualityEvent {
  const luz: LightLevel = condicion === 'SUFFICIENT_LIGHT_LEVEL' ? 'insuficiente' : condicion === 'EVEN_LIGHTING' ? 'justa' : 'optima';
  return {
    type: 'calidad',
    luz,
    rostroCentrado: rostroOk && condicion !== 'FACE_POSITION' && condicion !== 'FOREHEAD_VISIBLE',
    movimiento: condicion === 'FACE_STABLE' || condicion === 'DEVICE_STABLE',
    contraluz: condicion === 'NO_BACKLIGHT',
  };
}

/** Si la medición en curso perdió la señal, el motivo para el evento `senal_perdida`; si no, null. */
export function senalPerdida(estado: EstadoMedicionSdk, condicion: CondicionSdk | null): SignalLostEvent | null {
  if (estado === 'RUNNING_SIGNAL_BAD_DEVICE_UNSTABLE') return { type: 'senal_perdida', motivo: 'movimiento' };
  if (estado === 'WAITING_FOR_FACE') return { type: 'senal_perdida', motivo: 'rostro' };
  if (estado !== 'RUNNING_SIGNAL_BAD') return null;
  if (condicion === 'SUFFICIENT_LIGHT_LEVEL' || condicion === 'EVEN_LIGHTING' || condicion === 'NO_BACKLIGHT')
    return { type: 'senal_perdida', motivo: 'luz' };
  if (condicion === 'FACE_STABLE' || condicion === 'DEVICE_STABLE') return { type: 'senal_perdida', motivo: 'movimiento' };
  return { type: 'senal_perdida', motivo: 'rostro' };
}

/** Índice de estrés del SDK → escala 1–5 de SERENA (lineal y acotada). */
export function estresAEscala(indice: number, escala: EscalaEstres): number {
  const t = (indice - escala.min) / (escala.max - escala.min);
  const v = 1 + 4 * Math.min(1, Math.max(0, t));
  return Math.round(v * 10) / 10;
}

/** Métricas parciales (en vivo) que ya tienen valor. El estrés solo si hay escala confirmada. */
export function metricasParciales(r: ResultadosSdk, escala: EscalaEstres | null): Partial<ScanMetrics> {
  const m: Partial<ScanMetrics> = {};
  if (r.heart_rate_bpm !== null) m.pulso = Math.round(r.heart_rate_bpm);
  if (r.hrv_sdnn_ms !== null) m.hrv = Math.round(r.hrv_sdnn_ms);
  if (r.breathing_rate_bpm !== null) m.respiracion = Math.round(r.breathing_rate_bpm);
  if (r.stress_index !== null && escala) m.estres = estresAEscala(r.stress_index, escala);
  return m;
}

/**
 * Métricas finales. Si falta alguna, la medición no se da por válida (null): nunca se completan valores inventados,
 * porque alimentan el nivel de riesgo.
 */
export function metricasFinales(r: ResultadosSdk, escala: EscalaEstres): ScanMetrics | null {
  const m = metricasParciales(r, escala);
  if (m.pulso === undefined || m.hrv === undefined || m.respiracion === undefined || m.estres === undefined) return null;
  return m as ScanMetrics;
}

/** Calidad global 0–1. El SDK no documenta la escala de average_signal_quality: se acota a 0–1 hasta confirmarla. */
export const calidadGlobal = (r: ResultadosSdk) => Math.min(1, Math.max(0, r.average_signal_quality ?? 0));

/**
 * Preset del SDK según la duración. Las mediciones de 30 y 45 s figuran en el SDK como no validadas
 * (…_UNVALIDATED): solo la de 60 s usa el preset validado.
 */
export function presetParaDuracion(duracionS: number): { preset: 'ONE_MINUTE_HR_HRV_BR' | 'CUSTOM'; validado: boolean } {
  return duracionS === 60 ? { preset: 'ONE_MINUTE_HR_HRV_BR', validado: true } : { preset: 'CUSTOM', validado: false };
}
