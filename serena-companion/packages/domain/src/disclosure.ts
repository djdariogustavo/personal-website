import type { Level } from './types.ts';

/**
 * Control de divulgación estadística de los reportes para la empresa.
 *
 * El k-anonimato de grupo (≥ 5 personas) no alcanza: la empresa sabe quién
 * estaba en cada día de roster, así que una celda chica ("1 persona en alto")
 * o un grupo homogéneo ("todos en moderado o alto") identifica a alguien aunque
 * el grupo sea grande. Reglas, en orden:
 *
 *  1. Unidad = persona: se toma el último check-in de cada persona en cada día
 *     de roster. Nadie pesa más en la distribución por hacer más check-ins.
 *  2. Grupo mínimo: con menos de K_GRUPO personas no se publica nada.
 *  3. Celda mínima: ninguna categoría publicada puede tener entre 1 y
 *     K_CELDA - 1 personas. Si "moderado" o "alto" quedan chicos, se fusionan en
 *     "atención" (moderado o alto); si aun así queda una celda chica, no se
 *     publica la distribución de ese día.
 *  4. Homogeneidad: si todo el grupo está en "atención" (nadie en "bien"), no se
 *     publica, porque revelaría el nivel de cada integrante.
 *  5. Redondeo: las proporciones se publican en múltiplos de 5 puntos, sin los
 *     conteos por categoría.
 *  6. Ventana fija: 4 semanas completas (lunes a domingo, UTC) que terminan el
 *     domingo anterior. El reporte cambia una vez por semana, lo que impide
 *     deducir el nivel de una persona comparando el reporte de un día con el
 *     del siguiente (ataque por diferencia).
 */

export const K_GRUPO = 5;
export const K_CELDA = 3;
export const REDONDEO_PP = 5;
export const VENTANA_SEMANAS = 4;

export type MotivoOculto = 'grupo_chico' | 'celda_chica' | 'homogeneo';

export type Distribucion =
  | { tipo: 'completa'; bajo: number; moderado: number; alto: number }
  | { tipo: 'agrupada'; bajo: number; atencion: number };

export interface CeldaPublicable {
  personas: number | null;
  distribucion: Distribucion | null;
  motivo: MotivoOculto | null;
}

/** Último nivel de cada persona (las filas deben venir en orden cronológico). */
export function ultimoPorPersona(filas: Array<{ userId: string; nivel: Level }>): Level[] {
  const m = new Map<string, Level>();
  for (const f of filas) m.set(f.userId, f.nivel);
  return [...m.values()];
}

const chica = (n: number) => n > 0 && n < K_CELDA;

/** Redondea a múltiplos de REDONDEO_PP manteniendo la suma en 100 (mayor resto). */
export function redondear(conteos: number[]): number[] {
  const total = conteos.reduce((a, b) => a + b, 0);
  const pasos = 100 / REDONDEO_PP;
  const exactos = conteos.map((c) => (c / total) * pasos);
  const base = exactos.map(Math.floor);
  let faltan = pasos - base.reduce((a, b) => a + b, 0);
  const orden = exactos.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of orden) {
    if (faltan <= 0) break;
    base[i]!++;
    faltan--;
  }
  return base.map((b) => (b * REDONDEO_PP) / 100);
}

export function publicarDistribucion(niveles: Level[]): CeldaPublicable {
  const n = niveles.length;
  if (n < K_GRUPO) return { personas: null, distribucion: null, motivo: 'grupo_chico' };
  const bajo = niveles.filter((l) => l === 'bajo').length;
  const moderado = niveles.filter((l) => l === 'moderado').length;
  const alto = n - bajo - moderado;
  const atencion = moderado + alto;

  if (bajo === 0) return { personas: n, distribucion: null, motivo: 'homogeneo' };
  if (chica(bajo) || chica(atencion)) return { personas: n, distribucion: null, motivo: 'celda_chica' };
  if (chica(moderado) || chica(alto)) {
    const [b, a] = redondear([bajo, atencion]) as [number, number];
    return { personas: n, distribucion: { tipo: 'agrupada', bajo: b, atencion: a }, motivo: null };
  }
  const [b, m, a] = redondear([bajo, moderado, alto]) as [number, number, number];
  return { personas: n, distribucion: { tipo: 'completa', bajo: b, moderado: m, alto: a }, motivo: null };
}

/** Totales: exactos solo desde K_GRUPO; por debajo se informa "menos de K_GRUPO". */
export function publicarTotal(n: number): number | null {
  return n >= K_GRUPO ? n : null;
}

/** Ventana fija de 4 semanas completas (lunes 00:00 UTC) que termina al inicio de la semana en curso. */
export function ventanaReporte(ahora: Date = new Date()): { desde: string; hasta: string } {
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  const hasta = new Date(d.getTime() - desdeLunes * 86_400_000);
  const desde = new Date(hasta.getTime() - VENTANA_SEMANAS * 7 * 86_400_000);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}
