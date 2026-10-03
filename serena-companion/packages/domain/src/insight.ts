/**
 * "Lo que vemos en tus datos" (6.11): una observación en lenguaje simple sobre
 * cómo evoluciona el cansancio a lo largo del roster. Reglas transparentes, sin
 * modelos opacos ni lenguaje clínico. Si no hay datos suficientes, se dice.
 */
import type { CheckIn } from './types.ts';
import { selfReportScore } from './levels.ts';

export interface Insight {
  texto: string;
  suficiente: boolean;
}

/** Cansancio combinado 0–1: estrés del escaneo si lo hay, si no autorreporte. */
export function fatigueOf(c: CheckIn): number | null {
  if (c.escaneo) return (c.escaneo.metricas.estres - 1) / 4;
  return selfReportScore(c.animo, c.sueno);
}

export function rosterInsight(checkins: CheckIn[], diasTrabajo: number): Insight {
  const onShift = checkins.filter((c) => c.onShift && c.rosterDay !== null && !c.deleted);
  const byDay = new Map<number, number[]>();
  for (const c of onShift) {
    const f = fatigueOf(c);
    if (f === null) continue;
    const arr = byDay.get(c.rosterDay!) ?? [];
    arr.push(f);
    byDay.set(c.rosterDay!, arr);
  }
  const daysWithData = [...byDay.keys()].length;
  if (onShift.length < 8 || daysWithData < 6) {
    return {
      suficiente: false,
      texto:
        'Todavía hay pocos check-ins para ver un patrón. Con un par de rosters más te vamos a mostrar cómo cambia tu cansancio a lo largo del turno.',
    };
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const perDay = new Map<number, number>([...byDay.entries()].map(([d, v]) => [d, avg(v)]));
  const mitad = Math.ceil(diasTrabajo / 2);
  const primera = [...perDay.entries()].filter(([d]) => d <= mitad).map(([, v]) => v);
  const base = primera.length ? Math.min(...primera.slice().sort((a, b) => a - b).slice(0, Math.ceil(primera.length / 2))) : 0;
  const umbral = Math.max(base * 1.25, base + 0.15);
  // Primer día desde el cual el cansancio queda por encima del umbral de forma sostenida:
  // ese día lo supera y al menos el 75 % de los días siguientes con datos también.
  let desde: number | null = null;
  for (let d = 2; d <= diasTrabajo; d++) {
    const v = perDay.get(d);
    if (v === undefined || v < umbral) continue;
    const siguientes = [...perDay.entries()].filter(([k]) => k >= d).map(([, x]) => x);
    if (siguientes.length < 3) break;
    if (siguientes.filter((x) => x >= umbral).length / siguientes.length >= 0.75) {
      desde = d;
      break;
    }
  }
  if (desde === null) {
    return {
      suficiente: true,
      texto: 'Tu cansancio se mantiene bastante parejo a lo largo del roster. Seguí sumando pausas cortas cuando las necesites.',
    };
  }
  const pausa = Math.max(1, desde - 2);
  return {
    suficiente: true,
    texto: `En tus últimos rosters, el cansancio sube a partir del día ${desde}. Es común. Probá sumar una pausa corta desde el día ${pausa}.`,
  };
}
