import { analizarOcular, PARAMETROS_OCULAR, type MuestraOcular, type ParametrosOcular, type ResultadoOcular } from '@serena/domain';
import { earPromedio, inclinacion, type Punto } from './geometria.ts';

/**
 * Monitor de indicadores oculares: corre MediaPipe Face Landmarker sobre el mismo video del escaneo, en el
 * dispositivo, y guarda solo números por cuadro (EAR e inclinación). Ninguna imagen se guarda ni se envía.
 *
 * El motor y el modelo se sirven desde el propio origen (/vendor/mediapipe, lo copia scripts/vendor-mediapipe.mjs
 * al compilar): nada se descarga de terceros en el dispositivo.
 */

const BASE = '/vendor/mediapipe';
/** Hasta 30 cuadros/s: un parpadeo dura 100–400 ms, así que se ven varios cuadros por parpadeo. */
const INTERVALO_MS = 1000 / 30;

interface Landmarker {
  detectForVideo(video: HTMLVideoElement, ts: number): { faceLandmarks: Punto[][] };
  close(): void;
}

let cargando: Promise<Landmarker> | null = null;

/** Carga el modelo una sola vez por sesión de la app (≈ 15 MB entre motor y modelo). */
function cargar(): Promise<Landmarker> {
  cargando ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const crear = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}/face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    // GPU es más rápido; algunos equipos (kioscos viejos) no lo soportan.
    return (await crear('GPU').catch(() => crear('CPU'))) as unknown as Landmarker;
  })().catch((e) => {
    cargando = null;
    throw e;
  });
  return cargando;
}

export class MonitorOcular {
  private muestras: MuestraOcular[] = [];
  private inicio = 0;
  private ultimo = -Infinity;
  private raf = 0;
  private activo = false;
  /** Se detuvo (o se descartó) antes de que terminara de cargar el detector. */
  private terminado = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly parametros: Partial<ParametrosOcular>,
  ) {}

  /** Empieza a medir. Si el motor no carga, el monitor queda inactivo y el escaneo sigue igual. */
  async iniciar(): Promise<boolean> {
    let lm: Landmarker;
    try {
      lm = await cargar();
    } catch (e) {
      console.warn('[serena][ocular] No se pudo cargar el detector de rostro:', (e as Error).message);
      return false;
    }
    // Si el escaneo terminó mientras cargaba el detector, no se empieza a medir.
    if (this.terminado) return false;
    this.muestras = [];
    this.inicio = performance.now();
    this.activo = true;
    const paso = () => {
      if (!this.activo) return;
      const ahora = performance.now();
      const v = this.video;
      if (ahora - this.ultimo >= INTERVALO_MS && v.readyState >= 2 && v.videoWidth > 0) {
        this.ultimo = ahora;
        let puntos: Punto[] | undefined;
        try {
          puntos = lm.detectForVideo(v, ahora).faceLandmarks[0];
        } catch {
          puntos = undefined;
        }
        const w = v.videoWidth;
        const h = v.videoHeight;
        this.muestras.push({
          t: ahora - this.inicio,
          ear: puntos ? earPromedio(puntos, w, h) : null,
          inclinacion: puntos ? inclinacion(puntos, w, h) : null,
        });
      }
      this.raf = requestAnimationFrame(paso);
    };
    this.raf = requestAnimationFrame(paso);
    return true;
  }

  /** Termina y devuelve los indicadores; null si no llegó a medir. Descarta las muestras. */
  detener(): ResultadoOcular | null {
    const estaba = this.activo;
    this.activo = false;
    this.terminado = true;
    cancelAnimationFrame(this.raf);
    const muestras = this.muestras;
    this.muestras = [];
    // La configuración remota puede traer solo { habilitado: true }: lo que falte toma el valor por defecto.
    return estaba && muestras.length ? analizarOcular(muestras, { ...PARAMETROS_OCULAR, ...this.parametros }) : null;
  }
}
