/**
 * Geometría sobre los 478 puntos del rostro de MediaPipe Face Landmarker (coordenadas normalizadas 0–1).
 * Las distancias se calculan en píxeles (x por el ancho, y por el alto) para que no las deforme la relación de
 * aspecto del video.
 */

export interface Punto {
  x: number;
  y: number;
}

/**
 * Seis puntos por ojo para la relación de aspecto del ojo (EAR, Soukupová y Čech, 2016), con los índices de
 * MediaPipe más usados en la literatura: [comisura externa, párpado sup. 1, párpado sup. 2, comisura interna,
 * párpado inf. 2, párpado inf. 1].
 */
export const OJO_DERECHO = [33, 160, 158, 133, 153, 144] as const;
export const OJO_IZQUIERDO = [362, 385, 387, 263, 373, 380] as const;
/** Frente (entrecejo alto), punta de la nariz y mentón. */
export const FRENTE = 10;
export const NARIZ = 1;
export const MENTON = 152;

const dist = (a: Punto, b: Punto, w: number, h: number) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);

/** EAR de un ojo: (|p2−p6| + |p3−p5|) / (2·|p1−p4|). Ronda 0,25–0,35 abierto y cae hacia 0 al cerrarse. */
export function earOjo(lm: Punto[], idx: readonly number[], w: number, h: number): number | null {
  const p = idx.map((i) => lm[i]);
  if (p.some((x) => !x)) return null;
  const [p1, p2, p3, p4, p5, p6] = p as Punto[];
  const ancho = dist(p1!, p4!, w, h);
  if (ancho <= 0) return null;
  return (dist(p2!, p6!, w, h) + dist(p3!, p5!, w, h)) / (2 * ancho);
}

/** EAR promedio de ambos ojos (el parpadeo es simultáneo; promediar reduce el ruido). */
export function earPromedio(lm: Punto[], w: number, h: number): number | null {
  const d = earOjo(lm, OJO_DERECHO, w, h);
  const i = earOjo(lm, OJO_IZQUIERDO, w, h);
  if (d === null || i === null) return d ?? i;
  return (d + i) / 2;
}

/**
 * Proxy de inclinación de la cabeza: posición vertical de la nariz entre la frente y el mentón (0–1). Al caer la
 * cabeza hacia adelante, la nariz se acerca al mentón en la imagen y el valor sube. Es relativo a cada persona:
 * el análisis lo compara con su propia mediana.
 */
export function inclinacion(lm: Punto[], w: number, h: number): number | null {
  const f = lm[FRENTE];
  const n = lm[NARIZ];
  const m = lm[MENTON];
  if (!f || !n || !m) return null;
  const total = dist(f, m, w, h);
  return total > 0 ? dist(f, n, w, h) / total : null;
}
