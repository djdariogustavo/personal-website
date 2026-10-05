/**
 * Indicadores oculares de somnolencia a partir de la cámara del escaneo (MediaPipe Face Landmarker en el dispositivo).
 * Solo se guardan estos números: ninguna imagen sale del dispositivo.
 *
 * Métricas (literatura de detección de somnolencia, sobre todo en conducción):
 * - PERCLOS: proporción del tiempo con los ojos cerrados. Se usa el criterio P80 (párpado cubre ≥ 80 % del ojo),
 *   aproximado con la relación de aspecto del ojo (EAR) por debajo de una fracción de la apertura habitual de la
 *   persona en esa misma lectura.
 * - Parpadeos por minuto y duración media del parpadeo (se alarga con la somnolencia).
 * - Cierres largos: cierres de ≥ 500 ms, candidatos a microsueño.
 * - Cabeceos: caídas breves de la cabeza hacia adelante.
 *
 * ESTADO: MODO REGISTRO. Se validó sobre todo en observaciones de varios minutos; en 60 s es un indicador
 * complementario, no un diagnóstico. No interviene en el nivel de riesgo hasta que el equipo de salud ocupacional
 * defina y valide los umbrales (docs/PENDIENTES.md). Los parámetros de abajo son provisorios.
 */

/** Una muestra por cuadro. null = no se detectó el rostro en ese cuadro. */
export interface MuestraOcular {
  /** Milisegundos desde el inicio. */
  t: number;
  /** Relación de aspecto del ojo (EAR), promedio de ambos ojos. */
  ear: number | null;
  /** Inclinación de la cabeza (proxy geométrico: sube cuando la cabeza cae hacia adelante). */
  inclinacion: number | null;
}

export interface ParametrosOcular {
  /** Ojo "cerrado" (P80) cuando el EAR baja de esta fracción de la apertura habitual. Provisorio: 0,5. */
  fraccionCerrado: number;
  /** Duración mínima de un cierre largo (candidato a microsueño), ms. */
  cierreLargoMs: number;
  /** Subida de la inclinación sobre la mediana que cuenta como cabeceo (unidades del proxy). Provisorio. */
  cabeceoDelta: number;
  /** Proporción mínima del tiempo con el rostro detectado para que la lectura sea válida. */
  coberturaMin: number;
  /**
   * Cuadros por segundo mínimos para una lectura válida. Los parpadeos más cortos duran ~100 ms: con menos de
   * 15 cuadros/s se pierden parpadeos y la duración se mide con poca resolución.
   */
  cuadrosMinPorS: number;
}

export const PARAMETROS_OCULAR: ParametrosOcular = {
  fraccionCerrado: 0.5,
  cierreLargoMs: 500,
  cabeceoDelta: 0.08,
  coberturaMin: 0.7,
  cuadrosMinPorS: 15,
};

export interface ResultadoOcular {
  /** Proporción del tiempo válido con los ojos cerrados (0–1). */
  perclos: number;
  parpadeosPorMin: number;
  /** Duración media de los parpadeos (50–500 ms); null si no hubo parpadeos. */
  parpadeoMedioMs: number | null;
  /** Cierres de ≥ cierreLargoMs. */
  cierresLargos: number;
  /** El cierre más largo, ms. */
  cierreMaxMs: number;
  cabeceos: number;
  /** Proporción del tiempo con el rostro detectado (0–1). */
  cobertura: number;
  duracionS: number;
  /** Cuadros analizados por segundo en el dispositivo (depende del equipo: con GPU ~30, sin GPU ~10). */
  cuadrosPorS: number;
  /** false si la lectura no alcanza para interpretarla (poco rostro detectado, poco tiempo o pocos cuadros/s). */
  valido: boolean;
}

/** Duración mínima de rostro detectado para una lectura válida, s. */
const MIN_VALIDO_S = 20;
/** Un cierre más corto que esto es ruido de detección, no un parpadeo. */
const PARPADEO_MIN_MS = 50;
/** Un hueco mayor entre cuadros no se cuenta como tiempo observado. */
const HUECO_MAX_MS = 250;
/** Un cabeceo dura entre estos límites; más largo es una postura, no un cabeceo. */
const CABECEO_MS: [number, number] = [200, 3000];

function percentil(valores: number[], p: number): number {
  const v = [...valores].sort((a, b) => a - b);
  const i = Math.min(v.length - 1, Math.max(0, Math.round((p / 100) * (v.length - 1))));
  return v[i]!;
}

/** Tramos consecutivos donde se cumple `cond`, con su duración (hasta la muestra siguiente). */
function episodios(m: MuestraOcular[], cond: (x: MuestraOcular) => boolean): number[] {
  const out: number[] = [];
  let inicio: number | null = null;
  for (let i = 0; i < m.length; i++) {
    const s = m[i]!;
    if (cond(s)) {
      inicio ??= s.t;
    } else if (inicio !== null) {
      out.push(s.t - inicio);
      inicio = null;
    }
  }
  if (inicio !== null && m.length) out.push(m[m.length - 1]!.t - inicio + intervaloTipico(m));
  return out;
}

function intervaloTipico(m: MuestraOcular[]): number {
  if (m.length < 2) return 0;
  const d: number[] = [];
  for (let i = 1; i < m.length; i++) d.push(m[i]!.t - m[i - 1]!.t);
  return percentil(d, 50);
}

export function analizarOcular(muestras: MuestraOcular[], p: ParametrosOcular = PARAMETROS_OCULAR): ResultadoOcular {
  const m = [...muestras].sort((a, b) => a.t - b.t);
  const dt = intervaloTipico(m);
  const duracionMs = m.length ? m[m.length - 1]!.t - m[0]!.t + dt : 0;

  // Tiempo observado: cada muestra con rostro "pesa" el intervalo hasta la siguiente (acotado).
  let observadoMs = 0;
  let cerradoMs = 0;
  const conRostro = m.filter((s) => s.ear !== null);
  const base = conRostro.length >= 10 ? percentil(conRostro.map((s) => s.ear!), 90) : null;
  const cerrado = (s: MuestraOcular) => base !== null && s.ear !== null && s.ear < base * p.fraccionCerrado;
  for (let i = 0; i < m.length; i++) {
    const s = m[i]!;
    if (s.ear === null) continue;
    const peso = Math.min(HUECO_MAX_MS, i + 1 < m.length ? m[i + 1]!.t - s.t : dt);
    observadoMs += peso;
    if (cerrado(s)) cerradoMs += peso;
  }

  // Parpadeos y cierres largos: tramos cerrados, cortados por cuadros sin rostro (no se suponen cerrados).
  const cierres = episodios(m, cerrado);
  const parpadeos = cierres.filter((d) => d >= PARPADEO_MIN_MS && d < p.cierreLargoMs);
  const largos = cierres.filter((d) => d >= p.cierreLargoMs);

  // Cabeceos: la inclinación sube sobre su mediana y vuelve dentro de CABECEO_MS.
  const incl = m.filter((s) => s.inclinacion !== null).map((s) => s.inclinacion!);
  const mediana = incl.length ? percentil(incl, 50) : null;
  const cabeceos =
    mediana === null
      ? 0
      : episodios(m, (s) => s.inclinacion !== null && s.inclinacion > mediana + p.cabeceoDelta).filter(
          (d) => d >= CABECEO_MS[0] && d <= CABECEO_MS[1],
        ).length;

  const minutos = observadoMs / 60_000;
  const cuadrosPorS = duracionMs > 0 ? m.length / (duracionMs / 1000) : 0;
  const cobertura = duracionMs > 0 ? Math.min(1, observadoMs / duracionMs) : 0;
  const redondear = (x: number, dec: number) => Math.round(x * 10 ** dec) / 10 ** dec;
  return {
    perclos: observadoMs > 0 ? redondear(cerradoMs / observadoMs, 3) : 0,
    parpadeosPorMin: minutos > 0 ? redondear(parpadeos.length / minutos, 1) : 0,
    parpadeoMedioMs: parpadeos.length ? Math.round(parpadeos.reduce((a, b) => a + b, 0) / parpadeos.length) : null,
    cierresLargos: largos.length,
    cierreMaxMs: cierres.length ? Math.round(Math.max(...cierres)) : 0,
    cabeceos,
    cobertura: redondear(cobertura, 2),
    duracionS: redondear(duracionMs / 1000, 1),
    cuadrosPorS: redondear(cuadrosPorS, 1),
    valido: base !== null && cobertura >= p.coberturaMin && observadoMs >= MIN_VALIDO_S * 1000 && cuadrosPorS >= p.cuadrosMinPorS,
  };
}
