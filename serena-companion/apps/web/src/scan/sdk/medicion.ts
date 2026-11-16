import type { ScanEvent, ScanListener, ScanResult } from '@serena/domain';
import { calidadDesdeSdk, calidadGlobal, metricasFinales, metricasParciales, senalPerdida, type EscalaEstres } from '../shenai-map.ts';
import { metricasFaltantes } from './diagnostico.ts';
import { nombre, type ShenaiSdk } from './tipos.ts';

/**
 * Una medición del SDK, paso a paso. No usa temporizadores ni el DOM: quien la crea llama a `paso()` cada ~250 ms
 * y le da el reloj, así se prueba sola y una falla de la medición se busca solo en este archivo.
 *
 * Arranque como en los ejemplos oficiales 3.x (modo de operación MEASURE). A veces el SDK ignora el pedido y queda
 * en POSITIONING / NOT_STARTED con el rostro bien encuadrado (reproducido en ~1 de 10 intentos con el SDK real: el
 * reloj quedaba en 1:00 para siempre). Mientras no arranque se repite el pedido cada ARRANQUE_REINTENTO_MS, con
 * startMeasurement() de respaldo; si a los ARRANQUE_TOPE_MS sigue sin arrancar, termina en error.
 */
export const ARRANQUE_REINTENTO_MS = 2_000;
export const ARRANQUE_TOPE_MS = 20_000;
/** Momentos (ms) en los que se informa el estado de la medición al diagnóstico. */
const HITOS_MS = [3_000, 10_000, 20_000, 40_000];

/** Evento `calidad` con el estado actual del rostro y del entorno según el SDK. */
export function calidadActual(sdk: ShenaiSdk) {
  const rostro = nombre(sdk.FaceState, sdk.getFaceState());
  return calidadDesdeSdk(nombre(sdk.MeasurementEnvironmentCondition, sdk.getCurrentViolatedMeasurementEnvironmentCondition()), rostro === 'OK', rostro);
}

export interface OpcionesMedicion {
  sdk: ShenaiSdk;
  escala: EscalaEstres;
  duracionS: number;
  listener: ScanListener;
  /** Informa al diagnóstico: motivo, cómo se pidió el arranque y, si no es un hito normal, el código. */
  informar: (motivo: string, via: string, resultado?: string) => void;
  /** Reloj en milisegundos (performance.now). */
  ahora: () => number;
}

/** Cómo terminó la medición: el evento final y si ya se informó el motivo (para no informar "fin" además). */
export interface FinMedicion {
  evento: Extract<ScanEvent, { type: 'completo' | 'error' }>;
  informado: boolean;
}

export interface Medicion {
  /** Avanza la medición. Devuelve null mientras sigue, o cómo terminó. */
  paso(): FinMedicion | null;
  /** Cómo se pidió el arranque hasta ahora (para el diagnóstico). */
  via(): string;
}

export function crearMedicion(o: OpcionesMedicion): Medicion {
  const { sdk, escala, listener } = o;
  const t0 = o.ahora();
  const conModo = !!(sdk.setOperatingMode && sdk.OperatingMode?.MEASURE);
  const pedir = () => (conModo ? sdk.setOperatingMode!(sdk.OperatingMode!.MEASURE) : sdk.startMeasurement());
  pedir();
  let via = conModo ? 'MEASURE' : 'startMeasurement';
  let reintentos = 0;
  let arranco = false;
  let ultimaSenal = 0;
  const hitos = [...HITOS_MS];
  const fallida = (informado: boolean): FinMedicion => ({ evento: { type: 'error', codigo: 'medicion_fallida' }, informado });

  return {
    via: () => via,
    paso() {
      const transcurrido = o.ahora() - t0;
      if (hitos.length && transcurrido >= hitos[0]!) o.informar(`a los ${Math.round(hitos.shift()! / 1000)} s`, via);
      const estado = nombre(sdk.MeasurementState, sdk.getMeasurementState());
      if (!arranco && estado && estado !== 'NOT_STARTED') arranco = true;
      if (!arranco) {
        if (transcurrido >= ARRANQUE_TOPE_MS) {
          o.informar(`no arrancó en ${ARRANQUE_TOPE_MS / 1000} s`, via, 'NO_ARRANCA');
          return fallida(true);
        }
        if (transcurrido >= (reintentos + 1) * ARRANQUE_REINTENTO_MS) {
          reintentos++;
          via = conModo ? `MEASURE+startMeasurement${reintentos > 1 ? ` ×${reintentos}` : ''}` : `startMeasurement ×${reintentos + 1}`;
          if (conModo) pedir();
          sdk.startMeasurement();
        }
      }
      if (!estado) return null;
      if (estado === 'FAILED') return fallida(false);
      if (estado === 'FINISHED') {
        const r = sdk.getMeasurementResults();
        const metricas = r && metricasFinales(r, escala);
        if (!r || !metricas) {
          // Qué faltó (sin valores), para saber si es la señal, el encuadre o el plan de la licencia.
          const latidos = r && Array.isArray((r as { heartbeats?: unknown[] }).heartbeats) ? (r as unknown as { heartbeats: unknown[] }).heartbeats.length : '—';
          o.informar(`resultado incompleto (falta: ${metricasFaltantes(r)}; calidad ${r ? Math.round(calidadGlobal(r) * 100) : '—'}%; latidos ${latidos})`, via, 'RESULTADO_INCOMPLETO');
          return fallida(true);
        }
        for (const [n, v] of Object.entries(metricas)) listener({ type: 'metrica', nombre: n as keyof typeof metricas, valor: v, estable: true });
        const resultado: ScanResult = { metricas, calidad: calidadGlobal(r), duracionS: o.duracionS };
        return { evento: { type: 'completo', resultado }, informado: false };
      }
      listener({ type: 'progreso', valor: Math.min(1, sdk.getMeasurementProgressPercentage() / 100) });
      // Para que la pantalla diga qué corregir mientras el SDK mide (o espera el rostro antes de que avance el reloj).
      listener(calidadActual(sdk));
      const perdida = senalPerdida(estado, nombre(sdk.MeasurementEnvironmentCondition, sdk.getCurrentViolatedMeasurementEnvironmentCondition()));
      // La UI muestra una cuenta de 3 s: no se repite el aviso mientras dura.
      if (perdida && Date.now() - ultimaSenal > 3000) {
        ultimaSenal = Date.now();
        listener(perdida);
      }
      const parciales = sdk.getRealtimeMetrics(10);
      if (parciales)
        for (const [n, v] of Object.entries(metricasParciales(parciales, escala)))
          listener({ type: 'metrica', nombre: n as keyof ReturnType<typeof metricasParciales>, valor: v, estable: false });
      return null;
    },
  };
}
