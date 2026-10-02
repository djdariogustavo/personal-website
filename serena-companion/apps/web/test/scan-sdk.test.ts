import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanEvent } from '@serena/domain';
import { calidadDesdeSdk, estresAEscala, metricasFinales, metricasParciales, presetParaDuracion, senalPerdida } from '../src/scan/shenai-map.ts';
import { INIT_TOPE_MS, SdkScanProvider } from '../src/scan/sdk-adapter.ts';

const ESCALA = { min: 0, max: 10 };
const RESULTADOS = { heart_rate_bpm: 72.4, hrv_sdnn_ms: 48.6, breathing_rate_bpm: 14.2, stress_index: 5, average_signal_quality: 0.87 };

describe('traducción del SDK de escaneo al contrato de SERENA', () => {
  it('condiciones del entorno → evento de calidad', () => {
    expect(calidadDesdeSdk(null, true)).toEqual({ type: 'calidad', luz: 'optima', rostroCentrado: true, movimiento: false, contraluz: false });
    expect(calidadDesdeSdk('SUFFICIENT_LIGHT_LEVEL', true).luz).toBe('insuficiente');
    expect(calidadDesdeSdk('EVEN_LIGHTING', true).luz).toBe('justa');
    expect(calidadDesdeSdk('NO_BACKLIGHT', true).contraluz).toBe(true);
    expect(calidadDesdeSdk('DEVICE_STABLE', true).movimiento).toBe(true);
    expect(calidadDesdeSdk('FACE_POSITION', true).rostroCentrado).toBe(false);
    expect(calidadDesdeSdk(null, false).rostroCentrado).toBe(false);
  });

  it('pérdida de señal con su motivo, y nada mientras la señal es buena', () => {
    expect(senalPerdida('RUNNING_SIGNAL_GOOD', null)).toBeNull();
    expect(senalPerdida('RUNNING_SIGNAL_BAD', 'SUFFICIENT_LIGHT_LEVEL')?.motivo).toBe('luz');
    expect(senalPerdida('RUNNING_SIGNAL_BAD', 'FACE_STABLE')?.motivo).toBe('movimiento');
    expect(senalPerdida('RUNNING_SIGNAL_BAD', null)?.motivo).toBe('rostro');
    expect(senalPerdida('RUNNING_SIGNAL_BAD_DEVICE_UNSTABLE', null)?.motivo).toBe('movimiento');
    expect(senalPerdida('WAITING_FOR_FACE', null)?.motivo).toBe('rostro');
  });

  it('el estrés se lleva a 1–5 de forma lineal y acotada', () => {
    expect(estresAEscala(0, ESCALA)).toBe(1);
    expect(estresAEscala(5, ESCALA)).toBe(3);
    expect(estresAEscala(10, ESCALA)).toBe(5);
    expect(estresAEscala(-3, ESCALA)).toBe(1);
    expect(estresAEscala(99, ESCALA)).toBe(5);
  });

  it('sin escala confirmada, el estrés del SDK no se usa', () => {
    expect(metricasParciales(RESULTADOS, null)).toEqual({ pulso: 72, hrv: 49, respiracion: 14 });
  });

  it('una medición incompleta no se da por válida: no se inventan valores', () => {
    expect(metricasFinales(RESULTADOS, ESCALA)).toEqual({ pulso: 72, hrv: 49, respiracion: 14, estres: 3 });
    expect(metricasFinales({ ...RESULTADOS, breathing_rate_bpm: null }, ESCALA)).toBeNull();
    expect(metricasFinales({ ...RESULTADOS, stress_index: null }, ESCALA)).toBeNull();
  });

  it('solo la medición de 60 s usa el preset validado del SDK', () => {
    expect(presetParaDuracion(60)).toEqual({ preset: 'ONE_MINUTE_HR_HRV_BR', validado: true });
    expect(presetParaDuracion(45).validado).toBe(false);
    expect(presetParaDuracion(30).validado).toBe(false);
  });
});

/** Enums como los expone el SDK: objetos con `value`. */
const en = <K extends string>(...nombres: K[]) => Object.fromEntries(nombres.map((n, i) => [n, { value: i }])) as Record<K, { value: number }>;

/** SDK falso con la misma API que el real (subconjunto que usa SERENA). */
function sdkFalso(opts: { init?: 'OK' | 'INVALID_API_KEY' | 'CONNECTION_ERROR' | 'SIN_RESPUESTA'; resultados?: typeof RESULTADOS | null; falla?: boolean } = {}) {
  const MeasurementState = en('NOT_STARTED', 'WAITING_FOR_FACE', 'RUNNING_SIGNAL_SHORT', 'RUNNING_SIGNAL_GOOD', 'RUNNING_SIGNAL_BAD', 'RUNNING_SIGNAL_BAD_DEVICE_UNSTABLE', 'FINALIZING', 'FINISHED', 'FAILED');
  const InitializationResult = en('OK', 'INVALID_API_KEY', 'CONNECTION_ERROR', 'INTERNAL_ERROR');
  let estado = MeasurementState.NOT_STARTED;
  let progreso = 0;
  let inicializado = false;
  const llamadas: string[] = [];
  const settings: Array<Record<string, unknown>> = [];
  const sdk = {
    initialize: (_k: string, _u: string, s: Record<string, unknown>, cb: (r: { value: number }) => void) => {
      settings.push(s);
      // Como el SDK real ante algunas fallas: el motor se detiene y nunca llama al callback.
      if (opts.init === 'SIN_RESPUESTA') return;
      inicializado = (opts.init ?? 'OK') === 'OK';
      cb(InitializationResult[opts.init ?? 'OK']);
    },
    deinitialize: () => void (llamadas.push('deinitialize'), (inicializado = false)),
    isInitialized: () => inicializado,
    attachToCanvas: () => void llamadas.push('attachToCanvas'),
    setMediaStream: () => void llamadas.push('setMediaStream'),
    setRecordingEnabled: (v: boolean) => void llamadas.push(`setRecordingEnabled:${v}`),
    startMeasurement: () => void ((estado = MeasurementState.RUNNING_SIGNAL_GOOD), llamadas.push('startMeasurement')),
    stopMeasurement: () => void llamadas.push('stopMeasurement'),
    getMeasurementState: () => estado,
    getMeasurementProgressPercentage: () => progreso,
    getFaceState: () => ({ value: 0 }),
    getCurrentViolatedMeasurementEnvironmentCondition: () => null,
    getRealtimeMetrics: () => ({ ...RESULTADOS, breathing_rate_bpm: null }),
    getMeasurementResults: () => (opts.resultados === undefined ? RESULTADOS : opts.resultados),
    getLastCameraError: () => null,
    InitializationResult,
    MeasurementState,
    MeasurementEnvironmentCondition: en('FACE_POSITION', 'FOREHEAD_VISIBLE', 'GLASSES_NOT_DETECTED', 'SUFFICIENT_LIGHT_LEVEL', 'EVEN_LIGHTING', 'NO_BACKLIGHT', 'FACE_STABLE', 'DEVICE_STABLE'),
    FaceState: en('OK'),
    CameraMode: en('OFF', 'FACING_USER', 'FACING_ENVIRONMENT', 'DEVICE_ID', 'MEDIA_STREAM'),
    CameraError: en('UNKNOWN', 'UNSUPPORTED_MODE', 'NO_CAMERA_DEVICE', 'PERMISSION_NOT_GRANTED'),
    MeasurementPreset: en('ONE_MINUTE_HR_HRV_BR', 'CUSTOM'),
    PrecisionMode: en('STRICT'),
    OnboardingMode: en('HIDDEN'),
  };
  const args: Array<Record<string, unknown>> = [];
  const crear = async () => async (a: Record<string, unknown>) => (args.push(a), sdk);
  const avanzar = (p: number, fin?: 'FINISHED' | 'FAILED') => {
    progreso = p;
    if (fin) estado = MeasurementState[fin];
  };
  return { crear, llamadas, settings, args, avanzar };
}

describe('adaptador del SDK de escaneo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const nodos = new Map<string, { remove: () => void }>();
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('document', {
      getElementById: (id: string) => nodos.get(id) ?? null,
      createElement: () => ({ id: '', style: {}, setAttribute: () => undefined, remove() { nodos.delete(this.id); } }),
      body: { appendChild: (n: { id: string; remove: () => void }) => void nodos.set(n.id, n) },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('no está disponible sin licencia, sin escala de estrés, sin aislamiento de origen o sin conexión', async () => {
    const { crear } = sdkFalso();
    expect(await new SdkScanProvider(ESCALA, crear, '').availability({ online: true })).toEqual({ disponible: false, motivo: 'sin_licencia' });
    expect(await new SdkScanProvider(null, crear, 'k').availability({ online: true })).toEqual({ disponible: false, motivo: 'no_soportado' });
    expect(await new SdkScanProvider(ESCALA, crear, 'k').availability({ online: false })).toEqual({ disponible: false, motivo: 'sin_conexion' });
    expect(await new SdkScanProvider(ESCALA, crear, 'k').availability({ online: true })).toEqual({ disponible: true });
    vi.stubGlobal('crossOriginIsolated', false);
    expect(await new SdkScanProvider(ESCALA, crear, 'k').availability({ online: true })).toEqual({ disponible: false, motivo: 'no_soportado' });
  });

  it('se inicializa con privacidad y marca blanca: sin envío de errores, grabación, memoria local ni interfaz propia', async () => {
    const f = sdkFalso();
    await new SdkScanProvider(ESCALA, f.crear, 'k').mountPreview({} as HTMLElement, null, () => undefined);
    expect(f.args[0]).toMatchObject({ enableErrorReporting: false });
    expect(f.settings[0]).toMatchObject({ showUserInterface: false, hideShenaiLogo: true, localMemoryEnabled: false, enableHealthRisks: false });
    expect(f.llamadas).toContain('setRecordingEnabled:false');
  });

  it('emite progreso, métricas en vivo y el resultado completo con la escala de estrés', async () => {
    const f = sdkFalso();
    const eventos: ScanEvent[] = [];
    const p = new SdkScanProvider(ESCALA, f.crear, 'k');
    await p.start({ duracionS: 60 }, (e) => eventos.push(e));
    f.avanzar(50);
    await vi.advanceTimersByTimeAsync(300);
    expect(eventos).toContainEqual({ type: 'progreso', valor: 0.5 });
    expect(eventos).toContainEqual({ type: 'metrica', nombre: 'pulso', valor: 72, estable: false });
    f.avanzar(100, 'FINISHED');
    await vi.advanceTimersByTimeAsync(300);
    expect(eventos.at(-1)).toEqual({
      type: 'completo',
      resultado: { metricas: { pulso: 72, hrv: 49, respiracion: 14, estres: 3 }, calidad: 0.87, duracionS: 60 },
    });
    await p.stop();
    expect(f.llamadas).toContain('deinitialize');
  });

  it('si el SDK falla o el resultado está incompleto, informa medicion_fallida y no inventa valores', async () => {
    for (const caso of [{ fin: 'FAILED' as const }, { fin: 'FINISHED' as const, resultados: { ...RESULTADOS, hrv_sdnn_ms: null } }]) {
      const f = sdkFalso({ resultados: caso.resultados });
      const eventos: ScanEvent[] = [];
      await new SdkScanProvider(ESCALA, f.crear, 'k').start({ duracionS: 60 }, (e) => eventos.push(e));
      f.avanzar(100, caso.fin);
      await vi.advanceTimersByTimeAsync(300);
      expect(eventos.at(-1)).toEqual({ type: 'error', codigo: 'medicion_fallida' });
      expect(eventos.some((e) => e.type === 'completo')).toBe(false);
    }
  });

  it('si el SDK no responde a la inicialización, no deja a la persona esperando', async () => {
    const eventos: ScanEvent[] = [];
    const montaje = new SdkScanProvider(ESCALA, sdkFalso({ init: 'SIN_RESPUESTA' }).crear, 'k').mountPreview({} as HTMLElement, null, (e) => eventos.push(e));
    await vi.advanceTimersByTimeAsync(INIT_TOPE_MS + 100);
    await montaje;
    expect(eventos).toEqual([{ type: 'error', codigo: 'sin_conexion' }]);
  });

  it('una API key inválida o sin conexión al validar la licencia se informan como tales', async () => {
    for (const [init, codigo] of [
      ['INVALID_API_KEY', 'sin_licencia'],
      ['CONNECTION_ERROR', 'sin_conexion'],
    ] as const) {
      const eventos: ScanEvent[] = [];
      await new SdkScanProvider(ESCALA, sdkFalso({ init }).crear, 'k').mountPreview({} as HTMLElement, null, (e) => eventos.push(e));
      expect(eventos).toEqual([{ type: 'error', codigo }]);
    }
  });
});
