import type { ScanAvailability, ScanListener, ScanProvider, ScanResult } from '@serena/domain';
import {
  calidadDesdeSdk,
  calidadGlobal,
  metricasFinales,
  metricasParciales,
  presetParaDuracion,
  senalPerdida,
  type CondicionSdk,
  type EscalaEstres,
  type EstadoMedicionSdk,
  type ResultadosSdk,
} from './shenai-map.ts';

/**
 * Adaptador del SDK de escaneo (Shen.AI Web SDK 3.x en marca blanca). Traduce su API al contrato `ScanEvent`
 * (packages/domain/src/scan.ts); la traducción está en ./shenai-map.ts y tiene pruebas propias.
 *
 * El SDK NO está en el repositorio: su licencia comercial no permite usarlo sin contrato. Con el contrato,
 * `npm run scan:vendor -w @serena/web` copia el paquete a public/vendor/shenai (ignorado por git) y se sirve desde
 * el propio origen, que es lo que exige la política de seguridad (CSP) y el aislamiento de origen.
 *
 * Activación (build de la web):
 *   VITE_SCAN_PROVIDER=sdk
 *   VITE_SCAN_SDK_KEY=<API key del panel de cliente>
 *   VITE_SCAN_SDK_URL=/vendor/shenai/index.mjs   (opcional; es el valor por defecto)
 * y en el servidor SERENA_AISLAMIENTO_ORIGEN=true (COOP/COEP: el SDK usa SharedArrayBuffer).
 *
 * Privacidad (P4): se desactivan el envío de errores a terceros, la grabación, la memoria local y toda la
 * interfaz propia del SDK; SERENA nunca llama a las funciones que envían resultados o imágenes (PDF por email,
 * FHIR, fotos de tensiómetro, textura del rostro). Falta la confirmación por escrito del proveedor.
 *
 * Regla de marca: el SDK no muestra su interfaz ni su logo; el lienzo que necesita queda oculto.
 */

/** Subconjunto de la API del SDK que usa SERENA (tipos del paquete web 3.x). */
interface EnumSdk {
  readonly value: number;
}
type Enums<K extends string> = Record<K, EnumSdk>;
interface ShenaiSdk {
  initialize(apiKey: string, userId: string, settings: Record<string, unknown>, onResult: (r: EnumSdk) => void): void;
  deinitialize(): void;
  isInitialized(): boolean;
  attachToCanvas(selector: string, exclusive?: boolean): void;
  setMediaStream(stream: MediaStream, facingUser?: boolean): void;
  setRecordingEnabled(enabled: boolean): void;
  startMeasurement(): void;
  stopMeasurement(): void;
  getMeasurementState(): EnumSdk;
  getMeasurementProgressPercentage(): number;
  getFaceState(): EnumSdk;
  getCurrentViolatedMeasurementEnvironmentCondition(): EnumSdk | null;
  getRealtimeMetrics(periodSec: number): ResultadosSdk | null;
  getMeasurementResults(): ResultadosSdk | null;
  getLastCameraError(): EnumSdk | null;
  InitializationResult: Enums<'OK' | 'INVALID_API_KEY' | 'CONNECTION_ERROR' | 'INTERNAL_ERROR'>;
  MeasurementState: Enums<EstadoMedicionSdk>;
  MeasurementEnvironmentCondition: Enums<CondicionSdk>;
  FaceState: Enums<'OK'>;
  CameraMode: Enums<'FACING_USER' | 'MEDIA_STREAM'>;
  CameraError: Enums<'PERMISSION_NOT_GRANTED' | 'NO_CAMERA_DEVICE'>;
  MeasurementPreset: Enums<'ONE_MINUTE_HR_HRV_BR' | 'CUSTOM'>;
  PrecisionMode: Enums<'STRICT'>;
  OnboardingMode: Enums<'HIDDEN'>;
}
type CrearSdk = (args: Record<string, unknown>) => Promise<ShenaiSdk>;

const SDK_URL = (import.meta.env.VITE_SCAN_SDK_URL as string | undefined) || '/vendor/shenai/index.mjs';
const SDK_KEY = (import.meta.env.VITE_SCAN_SDK_KEY as string | undefined) ?? '';
const CANVAS_ID = 'serena-scan-sdk';
const CADA_MS = 250;

/** Nombre del valor de un enum del SDK (los enums son objetos con `value`). */
function nombre<K extends string>(e: Enums<K>, v: EnumSdk | null): K | null {
  if (!v) return null;
  return (Object.keys(e) as K[]).find((k) => e[k].value === v.value) ?? null;
}

/**
 * Identificador para el SDK: seudónimo aleatorio por dispositivo, nunca el de la persona. Con la memoria local
 * desactivada, el SDK no lo usa para guardar datos.
 */
function idSeudonimo(): string {
  try {
    const k = 'serena.scan.id';
    const previo = localStorage.getItem(k);
    if (previo) return previo;
    const nuevo = crypto.randomUUID();
    localStorage.setItem(k, nuevo);
    return nuevo;
  } catch {
    return crypto.randomUUID();
  }
}

export class SdkScanProvider implements ScanProvider {
  readonly id = 'sdk';
  private sdk: ShenaiSdk | null = null;
  private cargando: Promise<ShenaiSdk> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stream: MediaStream | null = null;

  /**
   * @param escalaEstres rango del índice de estrés del SDK (configuración remota escaneo.escalaEstresSdk).
   * @param crear para las pruebas; por defecto importa el SDK servido desde el propio origen.
   */
  constructor(
    private readonly escalaEstres: EscalaEstres | null,
    private readonly crear: () => Promise<CrearSdk> = async () =>
      ((await import(/* @vite-ignore */ SDK_URL)) as { default: CrearSdk }).default,
    private readonly apiKey: string = SDK_KEY,
  ) {}

  async availability(ctx: { online: boolean }): Promise<ScanAvailability> {
    if (!this.apiKey) return { disponible: false, motivo: 'sin_licencia' };
    // Sin la escala confirmada, el estrés del SDK no puede alimentar el nivel de riesgo.
    if (!this.escalaEstres) {
      console.warn('[serena][escaneo] Falta escaneo.escalaEstresSdk en la configuración: el escaneo queda deshabilitado.');
      return { disponible: false, motivo: 'no_soportado' };
    }
    if (typeof globalThis.crossOriginIsolated !== 'boolean' || !globalThis.crossOriginIsolated) return { disponible: false, motivo: 'no_soportado' };
    // P1: la licencia se obtiene en línea en el primer uso; sin conexión no se intenta.
    if (!ctx.online && !this.sdk) return { disponible: false, motivo: 'sin_conexion' };
    return { disponible: true };
  }

  async mountPreview(_container: HTMLElement, stream: MediaStream | null, listener: ScanListener): Promise<void> {
    this.stream = stream;
    const sdk = await this.inicializar(listener);
    if (!sdk) return;
    this.cada(() => listener(this.calidad(sdk)));
  }

  async start(opts: { duracionS: number }, listener: ScanListener): Promise<void> {
    const sdk = this.sdk ?? (await this.inicializar(listener));
    if (!sdk) return;
    const { validado } = presetParaDuracion(opts.duracionS);
    if (!validado) console.warn(`[serena][escaneo] Medición de ${opts.duracionS} s: el SDK la marca como no validada; usar 60 s.`);
    const escala = this.escalaEstres!;
    let ultimaSenal = 0;
    sdk.startMeasurement();
    this.cada(() => {
      const estado = nombre(sdk.MeasurementState, sdk.getMeasurementState());
      if (!estado) return;
      if (estado === 'FAILED') return this.terminar(() => listener({ type: 'error', codigo: 'medicion_fallida' }));
      if (estado === 'FINISHED') {
        const r = sdk.getMeasurementResults();
        const metricas = r && metricasFinales(r, escala);
        if (!r || !metricas) return this.terminar(() => listener({ type: 'error', codigo: 'medicion_fallida' }));
        for (const [n, v] of Object.entries(metricas)) listener({ type: 'metrica', nombre: n as keyof typeof metricas, valor: v, estable: true });
        const resultado: ScanResult = { metricas, calidad: calidadGlobal(r), duracionS: opts.duracionS };
        return this.terminar(() => listener({ type: 'completo', resultado }));
      }
      listener({ type: 'progreso', valor: Math.min(1, sdk.getMeasurementProgressPercentage() / 100) });
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
    });
  }

  /** Libera la medición, la cámara del SDK y el lienzo. El módulo queda cargado para el próximo check-in. */
  async stop(): Promise<void> {
    this.detener();
    const sdk = this.sdk;
    if (sdk?.isInitialized()) {
      sdk.stopMeasurement();
      sdk.deinitialize();
    }
    document.getElementById(CANVAS_ID)?.remove();
    this.stream = null;
  }

  private async inicializar(listener: ScanListener): Promise<ShenaiSdk | null> {
    let sdk: ShenaiSdk;
    try {
      this.cargando ??= this.crear().then((crear) =>
        crear({
          enableErrorReporting: false, // P4: sin envío de errores a terceros
          enablePreloadDisplay: false,
        }),
      );
      sdk = await this.cargando;
    } catch (e) {
      this.cargando = null;
      console.error('[serena][escaneo] No se pudo cargar el SDK:', (e as Error).message);
      listener({ type: 'error', codigo: 'no_soportado' });
      return null;
    }
    this.sdk = sdk;
    if (sdk.isInitialized()) return sdk;

    let canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
    if (!canvas) {
      // El SDK necesita un lienzo; la vista previa la muestra SERENA, así que queda fuera de pantalla.
      canvas = document.createElement('canvas');
      canvas.id = CANVAS_ID;
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { position: 'fixed', left: '-10000px', top: '0', width: '320px', height: '240px' });
      document.body.appendChild(canvas);
    }

    const resultado = await new Promise<EnumSdk>((listo) =>
      sdk.initialize(
        this.apiKey,
        idSeudonimo(),
        {
          cameraMode: this.stream ? sdk.CameraMode.MEDIA_STREAM : sdk.CameraMode.FACING_USER,
          precisionMode: sdk.PrecisionMode.STRICT,
          measurementPreset: sdk.MeasurementPreset.ONE_MINUTE_HR_HRV_BR,
          onboardingMode: sdk.OnboardingMode.HIDDEN,
          showUserInterface: false,
          hideShenaiLogo: true,
          showDisclaimer: false,
          enableSummaryScreen: false,
          enableHealthRisks: false,
          enableMeasurementsDashboard: false,
          localMemoryEnabled: false,
          language: 'es',
        },
        listo,
      ),
    );
    const r = nombre(sdk.InitializationResult, resultado);
    if (r !== 'OK') {
      console.error(`[serena][escaneo] El SDK no se inicializó: ${r ?? 'desconocido'}`);
      listener({ type: 'error', codigo: r === 'CONNECTION_ERROR' ? 'sin_conexion' : 'sin_licencia' });
      return null;
    }
    sdk.setRecordingEnabled(false);
    if (this.stream) sdk.setMediaStream(this.stream, true);
    sdk.attachToCanvas(`#${CANVAS_ID}`);
    const errorCamara = nombre(sdk.CameraError, sdk.getLastCameraError());
    if (errorCamara) {
      listener({ type: 'error', codigo: errorCamara === 'PERMISSION_NOT_GRANTED' ? 'sin_permiso' : 'sin_camara' });
      return null;
    }
    return sdk;
  }

  private calidad(sdk: ShenaiSdk) {
    const rostroOk = nombre(sdk.FaceState, sdk.getFaceState()) === 'OK';
    return calidadDesdeSdk(nombre(sdk.MeasurementEnvironmentCondition, sdk.getCurrentViolatedMeasurementEnvironmentCondition()), rostroOk);
  }

  private cada(fn: () => void) {
    this.detener();
    this.timer = setInterval(fn, CADA_MS);
  }

  private detener() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private terminar(emitir: () => void) {
    this.detener();
    this.sdk?.stopMeasurement();
    emitir();
  }
}
