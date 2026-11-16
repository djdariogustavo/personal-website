import { nombre, type Enums, type ShenaiSdk } from './tipos.ts';

/**
 * Diagnóstico de campo del escaneo: qué pasó en cada inicialización y medición, para explicar una falla desde los
 * registros del servidor. Nunca lleva datos de la persona ni valores de la medición (solo estados y presencia).
 */

export type EtapaInicio = 'importar' | 'crear' | 'licencia' | 'camara' | 'medicion';

/**
 * Resultado de una inicialización o medición: código (OK, CONNECTION_ERROR, SIN_RESPUESTA, NO_ARRANCA, …), duración
 * y, si hubo una excepción, su tipo y mensaje (p. ej. "RangeError: Out of memory").
 */
export interface DiagnosticoInicio {
  resultado: string;
  etapa: EtapaInicio;
  ms: number;
  detalle?: string;
  /** Bytes recibidos del motor del SDK (shenai_sdk.wasm, ~36 MB) y del módulo, si el navegador llegó a pedirlos. */
  wasmBytes?: number;
  moduloEstado?: number;
}

export type InformarDiagnostico = (d: DiagnosticoInicio) => void;

/**
 * Cuánto se descargó del SDK según el registro de recursos del navegador (Resource Timing): sin el motor WASM
 * completo el SDK no arranca, y en un teléfono con poca memoria o mala red ahí suele estar la falla.
 */
export function descargasSdk(): Pick<DiagnosticoInicio, 'wasmBytes' | 'moduloEstado'> {
  try {
    const recursos = performance.getEntriesByType('resource') as Array<PerformanceResourceTiming & { responseStatus?: number }>;
    const wasm = recursos.filter((r) => r.name.includes('/vendor/shenai/') && r.name.endsWith('.wasm')).at(-1);
    const modulo = recursos.filter((r) => r.name.includes('/vendor/shenai/index.mjs')).at(-1);
    return {
      ...(wasm ? { wasmBytes: Math.round(wasm.encodedBodySize || wasm.transferSize || 0) } : {}),
      ...(modulo?.responseStatus ? { moduloEstado: modulo.responseStatus } : {}),
    };
  } catch {
    return {};
  }
}

/** Tipo y mensaje de una excepción del navegador o del SDK, acotado para el registro. */
export function detalleError(e: unknown): string {
  // Algunos motores (Emscripten) rechazan con undefined o un número, sin un Error: también se informa.
  if (e === undefined || e === null) return `sin detalle (rechazo con ${String(e)})`;
  // Por nombre y mensaje (no instanceof): un Error creado en otro marco (iframe) no es instancia del Error de este.
  const esError = e instanceof Error || (typeof e === 'object' && typeof (e as Error).message === 'string' && typeof (e as Error).name === 'string');
  const tipo = esError ? (e as Error).name : typeof e;
  const mensaje = esError ? (e as Error).message : String(e);
  return `${tipo}: ${mensaje}`.replace(/[^\x20-\x7E -ÿ]/g, ' ').slice(0, 200);
}

const METRICAS = ['heart_rate_bpm', 'hrv_sdnn_ms', 'breathing_rate_bpm', 'stress_index'] as const;

/** Nombres de las métricas sin valor en un resultado del SDK (solo nombres: los valores son datos de salud). */
export function metricasFaltantes(r: object | null): string {
  if (!r) return 'sin resultados';
  return METRICAS.filter((k) => (r as Record<string, unknown>)[k] === null || (r as Record<string, unknown>)[k] === undefined).join(', ') || '—';
}

/** Estado del SDK en una línea. `pista` es la copia de la cámara que recibe el SDK; `lienzo`, el suyo. */
export function fotoSdk(sdk: ShenaiSdk, via: string, pista: MediaStreamTrack | undefined, lienzo: HTMLCanvasElement | null): string {
  const leer = (f: () => string | number | null) => {
    try {
      return f() ?? '—';
    } catch {
      return 'error';
    }
  };
  const ajustes = pista?.getSettings?.() ?? {};
  return [
    `inicio ${via}`,
    `estado ${leer(() => nombre(sdk.MeasurementState, sdk.getMeasurementState()))}`,
    `modo ${leer(() => (sdk.getOperatingMode && sdk.OperatingMode ? nombre(sdk.OperatingMode, sdk.getOperatingMode()) : null))}`,
    `rostro ${leer(() => nombre(sdk.FaceState as Enums<string>, sdk.getFaceState()) ?? `#${sdk.getFaceState()?.value}`)}`,
    `condición ${leer(() => nombre(sdk.MeasurementEnvironmentCondition, sdk.getCurrentViolatedMeasurementEnvironmentCondition()))}`,
    `progreso ${leer(() => Math.round(sdk.getMeasurementProgressPercentage()))}%`,
    // Qué métricas en vivo ya tienen valor (solo presencia, sin valores: son datos de salud).
    `en vivo ${leer(() => {
      const r = sdk.getRealtimeMetrics(10);
      if (!r) return null;
      const hay = METRICAS.filter((k) => r[k] !== null && r[k] !== undefined);
      return hay.length ? hay.map((k) => k.split('_')[0]).join('+') : 'ninguna';
    })}`,
    `plan ${leer(() => (sdk.getPricingPlan ? sdk.getPricingPlan() || 'vacío' : null))}${leer(() => (sdk.isGeneralWellnessSdk?.() ? ' (bienestar general)' : ''))}`,
    `listo ${leer(() => (sdk.isReadyToStartMeasurement ? (sdk.isReadyToStartMeasurement() ? 'sí' : 'no') : null))}`,
    `modelos ${leer(() => (sdk.getRequiredModelsDownloadProgressPercentage ? `${Math.round(sdk.getRequiredModelsDownloadProgressPercentage())}%` : null))}`,
    `pista ${pista ? `${pista.readyState}${ajustes.width ? ` ${ajustes.width}x${ajustes.height}` : ''}` : 'ninguna'}`,
    `lienzo ${lienzo ? `${lienzo.width}x${lienzo.height}` : '—'}`,
  ].join(' · ');
}
