/**
 * Cálculo del día de roster (p. ej. 14 × 14: 14 días de trabajo, 14 de descanso).
 * El ciclo se ancla en `inicio` = día 1 de trabajo de un ciclo cualquiera.
 */

export interface RosterConfig {
  inicio: string; // YYYY-MM-DD
  diasTrabajo: number;
  diasDescanso: number;
}

export interface RosterStatus {
  enTurno: boolean;
  /** Día dentro de la fase actual (1-based): "Día 9 de 14" o "Descanso · Día 3 de 14". */
  dia: number;
  total: number;
  /** Día absoluto dentro del ciclo completo (1-based). */
  diaCiclo: number;
}

const MS_DAY = 86_400_000;

function parseLocalDate(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function rosterStatus(cfg: RosterConfig, at: Date = new Date()): RosterStatus {
  const ciclo = cfg.diasTrabajo + cfg.diasDescanso;
  if (ciclo <= 0) throw new Error('Roster inválido');
  const diff = Math.floor((dayNumber(at) - parseLocalDate(cfg.inicio)) / MS_DAY);
  const pos = ((diff % ciclo) + ciclo) % ciclo; // 0-based dentro del ciclo
  const enTurno = pos < cfg.diasTrabajo;
  return {
    enTurno,
    dia: enTurno ? pos + 1 : pos - cfg.diasTrabajo + 1,
    total: enTurno ? cfg.diasTrabajo : cfg.diasDescanso,
    diaCiclo: pos + 1,
  };
}

/** Saludo según la hora local. */
export function saludo(at: Date = new Date()): 'Buenos días' | 'Buenas tardes' | 'Buenas noches' {
  const h = at.getHours();
  if (h >= 6 && h < 13) return 'Buenos días';
  if (h >= 13 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export function rosterChip(st: RosterStatus, turno: 'dia' | 'noche'): string {
  return st.enTurno
    ? `ROSTER · DÍA ${st.dia} DE ${st.total} · TURNO ${turno === 'noche' ? 'NOCHE' : 'DÍA'}`
    : `DESCANSO · DÍA ${st.dia} DE ${st.total}`;
}
