import type { ScanErrorCode } from '@serena/domain';
import { descargasSdk, detalleError, type EtapaInicio, type InformarDiagnostico } from './diagnostico.ts';
import { nombre, type CrearSdk, type EnumSdk, type ShenaiSdk } from './tipos.ts';

/**
 * Inicialización del SDK de escaneo: descarga del motor, credencial, lienzo, licencia y cámara. Cada etapa informa
 * al diagnóstico, y cualquier falla termina en un código de error del escaneo (nunca en una espera sin fin).
 */

/**
 * Credencial para initialize(): una clave fija o una función que obtiene un token de corta duración (del servidor) en
 * cada inicialización. La función devuelve el código de error del escaneo si no pudo obtenerlo.
 */
export type CredencialEscaneo = string | (() => Promise<string | ScanErrorCode>);
const esCodigoError = (v: string): v is ScanErrorCode => !v.startsWith('sh_') && /^[a-z_]+$/.test(v);

export const CANVAS_ID = 'serena-scan-sdk';
/**
 * Tope para que el SDK responda a initialize (valida la licencia en línea y descarga sus modelos). Probado con el SDK
 * real 3.1.15: ante algunas fallas el motor se detiene (Aborted) sin llamar al callback, y sin tope la persona quedaría
 * esperando. Con la clave real, sin GPU, respondió OK en 11,5 a 19,6 s: el tope deja más del doble de margen.
 */
export const INIT_TOPE_MS = 45_000;
/** Tope para descargar e instanciar el SDK (módulo y motor WASM de ~36 MB) con una conexión móvil lenta. */
export const CARGA_TOPE_MS = 120_000;

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

/** El lienzo que el SDK necesita, fuera de pantalla (la vista previa la muestra SERENA) y con la resolución del video. */
function prepararLienzo(ancho: number, alto: number): void {
  let canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', left: '-10000px', top: '0', width: '480px', height: '640px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(canvas);
  }
  // Resolución del lienzo = la del video (ejemplo oficial); sin esto queda en 300×150.
  canvas.width = ancho;
  canvas.height = alto;
}

const quitarLienzo = () => document.getElementById(CANVAS_ID)?.remove();

/** Ajustes de initialize(): privacidad (P4) y marca blanca. Sin interfaz propia, grabación ni memoria local. */
function ajustesInicio(sdk: ShenaiSdk, conCamaraPropia: boolean, proporcion: number): Record<string, unknown> {
  return {
    // Con cámara propia: OFF al inicializar y la cámara con setMediaStream (ejemplo WebRTC oficial).
    cameraMode: conCamaraPropia ? sdk.CameraMode.OFF ?? sdk.CameraMode.MEDIA_STREAM : sdk.CameraMode.FACING_USER,
    ...(sdk.OperatingMode?.POSITIONING ? { operatingMode: sdk.OperatingMode.POSITIONING } : {}),
    ...(proporcion ? { cameraAspectRatio: proporcion } : {}),
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
  };
}

export interface ContextoInicio {
  /** Carga del motor en curso o terminada: se comparte entre intentos y se descarta (null) si quedó inutilizable. */
  motor: { cargando: Promise<ShenaiSdk> | null };
  crear: () => Promise<CrearSdk>;
  credencial: CredencialEscaneo;
  diagnostico: InformarDiagnostico;
  /** Cámara de la app, si la hay (si no, el SDK abre la suya). */
  stream: MediaStream | null;
  /** Entrega la cámara al SDK ya inicializado. */
  conectarCamara: (sdk: ShenaiSdk) => void;
}

/**
 * Inicializa el SDK. Cualquier excepción no prevista se informa y termina en error, en lugar de cortar la cadena sin
 * aviso: así se perdió el motivo real en la prueba en el teléfono (solo quedaba el INICIO).
 */
export async function iniciarSdk(ctx: ContextoInicio): Promise<ShenaiSdk | ScanErrorCode> {
  const estado: { etapa: EtapaInicio; t0: number } = { etapa: 'importar', t0: performance.now() };
  try {
    return await pasos(ctx, estado);
  } catch (e) {
    console.error('[serena][escaneo] Falla no prevista al iniciar el SDK:', detalleError(e));
    ctx.diagnostico({ resultado: 'EXCEPCION_INTERNA', etapa: estado.etapa, ms: Math.round(performance.now() - estado.t0), detalle: detalleError(e), ...descargasSdk() });
    ctx.motor.cargando = null;
    quitarLienzo();
    return 'no_soportado';
  }
}

async function pasos(ctx: ContextoInicio, estado: { etapa: EtapaInicio; t0: number }): Promise<ShenaiSdk | ScanErrorCode> {
  /** Informa el resultado; con un segundo argumento (aunque sea undefined) agrega el detalle del error. */
  const informar = (resultado: string, ...error: unknown[]) =>
    ctx.diagnostico({
      resultado,
      etapa: estado.etapa,
      ms: Math.round(performance.now() - estado.t0),
      ...(error.length ? { detalle: detalleError(error[0]) } : {}),
      ...descargasSdk(),
    });
  // Primer aviso: confirma en el registro que el teléfono llegó a intentar el arranque, aunque después se corte.
  informar('INICIO');

  // 1. Motor (módulo y WASM de ~36 MB).
  let sdk: ShenaiSdk;
  try {
    ctx.motor.cargando ??= ctx.crear().then((crear) => {
      estado.etapa = 'crear';
      return crear({
        enableErrorReporting: false, // P4: sin envío de errores a terceros
        enablePreloadDisplay: false,
      });
    });
    // Tope para la descarga: sin él, una descarga trabada dejaría "Preparando…" para siempre.
    let topeCarga: ReturnType<typeof setTimeout> | undefined;
    sdk = await Promise.race([
      ctx.motor.cargando,
      new Promise<never>((_, falla) => {
        topeCarga = setTimeout(() => falla(new Error(`la carga no terminó en ${CARGA_TOPE_MS / 1000} s`)), CARGA_TOPE_MS);
      }),
    ]).finally(() => clearTimeout(topeCarga));
  } catch (e) {
    ctx.motor.cargando = null;
    console.error('[serena][escaneo] No se pudo cargar el SDK:', detalleError(e));
    informar('CARGA_FALLIDA', e);
    return 'no_soportado';
  }
  estado.etapa = 'licencia';
  if (sdk.isInitialized()) return sdk;

  // 2. Credencial: con tokens del servidor se pide uno nuevo en cada inicialización (vida corta, un dispositivo).
  let clave: string;
  if (typeof ctx.credencial === 'string') clave = ctx.credencial;
  else {
    let obtenida: string | ScanErrorCode;
    try {
      obtenida = await ctx.credencial();
    } catch (e) {
      console.error('[serena][escaneo] No se pudo obtener el token del escaneo:', detalleError(e));
      obtenida = 'sin_conexion';
    }
    if (esCodigoError(obtenida)) {
      informar(obtenida === 'sin_conexion' ? 'TOKEN_SIN_CONEXION' : 'TOKEN_RECHAZADO');
      return obtenida;
    }
    clave = obtenida;
  }

  // 3. Lienzo y licencia.
  const ajustes = ctx.stream?.getVideoTracks()[0]?.getSettings?.() ?? {};
  const ancho = ajustes.width || 640;
  const alto = ajustes.height || 480;
  prepararLienzo(ancho, alto);
  let tope: ReturnType<typeof setTimeout> | undefined;
  let errorInit: unknown;
  const resultado = await new Promise<EnumSdk | null>((listo) => {
    tope = setTimeout(() => listo(null), INIT_TOPE_MS);
    try {
      sdk.initialize(clave, idSeudonimo(), ajustesInicio(sdk, !!ctx.stream, ancho && alto ? ancho / alto : 0), listo);
    } catch (e) {
      console.error('[serena][escaneo] El SDK falló al inicializarse:', detalleError(e));
      errorInit = e;
      listo(null);
    }
  }).finally(() => clearTimeout(tope));
  if (resultado === null) {
    // El motor puede haber quedado inutilizable: la próxima vez se vuelve a crear desde cero.
    console.error(`[serena][escaneo] El SDK no respondió a la inicialización en ${INIT_TOPE_MS / 1000} s.`);
    ctx.motor.cargando = null;
    quitarLienzo();
    if (errorInit !== undefined) informar('EXCEPCION', errorInit);
    else informar('SIN_RESPUESTA');
    return 'sin_conexion';
  }
  const r = nombre(sdk.InitializationResult, resultado);
  if (r !== 'OK') {
    console.error(`[serena][escaneo] El SDK no se inicializó: ${r ?? 'desconocido'}`);
    informar(r ?? 'DESCONOCIDO');
    quitarLienzo();
    return r === 'CONNECTION_ERROR' ? 'sin_conexion' : 'sin_licencia';
  }

  // 4. Cámara.
  estado.etapa = 'camara';
  try {
    sdk.setRecordingEnabled(false);
    sdk.attachToCanvas(`#${CANVAS_ID}`);
    ctx.conectarCamara(sdk);
  } catch (e) {
    // La licencia validó pero el SDK no pudo tomar la cámara o el lienzo: también va al diagnóstico.
    console.error('[serena][escaneo] El SDK no pudo conectarse a la cámara:', detalleError(e));
    informar('CONEXION_CAMARA_FALLIDA', e);
    sdk.deinitialize();
    return 'no_soportado';
  }
  const errorCamara = nombre(sdk.CameraError, sdk.getLastCameraError());
  if (errorCamara) {
    informar(`CAMARA_${errorCamara}`);
    sdk.deinitialize();
    return errorCamara === 'PERMISSION_NOT_GRANTED' ? 'sin_permiso' : 'sin_camara';
  }
  informar('OK');
  return sdk;
}
