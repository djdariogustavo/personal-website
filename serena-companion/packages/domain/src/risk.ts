/**
 * Detección de señales de riesgo en el texto del chat (estado de cuidado, 6.10).
 *
 * Es la red de seguridad determinística que corre del lado del servidor ANTES
 * de llamar al modelo: si el modelo falla, no responde o no marca el riesgo,
 * igual se activa el estado de cuidado. El modelo puede sumar detección, nunca
 * restarla. Se prefiere el falso positivo (mostrar ayuda de más) al falso
 * negativo.
 *
 * La lista debe revisarla el equipo de salud ocupacional de cada faena.
 */

export type RiskLevel = 'ninguno' | 'posible' | 'alto';

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zñ0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Expresiones de riesgo alto: intención o ideación de daño a sí mismo. */
const HIGH: RegExp[] = [
  /\b(matarme|suicid\w*|quitarme la vida|sacarme la vida|terminar con mi vida|acabar con mi vida)\b/,
  /\b(hacerme dano|lastimarme|cortarme|hacerme mal a mi mismo)\b/,
  /\bno (quiero|quisiera) (seguir|vivir|estar mas|despertar(me)?)\b/,
  /\b(me quiero|quisiera|prefiero) (morir|morirme|desaparecer)\b/,
  /\bmejor (muerto|no estar)\b/,
  /\b(tirarme|arrojarme) (de|del|al|a las|a la|abajo)\b/,
  /\bno (tiene|le encuentro) sentido (vivir|seguir)\b/,
  /\bdespedirme de (todos|mi familia|mis hijos)\b/,
];

/** Señales de posible riesgo: desesperanza intensa, sin mención explícita de daño. */
const POSSIBLE: RegExp[] = [
  /\bno doy mas\b/,
  /\bno aguanto mas\b/,
  /\b(sin salida|no hay salida)\b/,
  /\bsoy una carga\b/,
  /\bnadie me (necesita|extranaria)\b/,
  /\bestaria(n)? mejor sin mi\b/,
];

export function detectRisk(text: string): RiskLevel {
  const n = normalize(text);
  if (HIGH.some((r) => r.test(n))) return 'alto';
  if (POSSIBLE.some((r) => r.test(n))) return 'posible';
  return 'ninguno';
}

const RANK: Record<RiskLevel, number> = { ninguno: 0, posible: 1, alto: 2 };
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RANK[a] >= RANK[b] ? a : b;
}
