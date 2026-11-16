import type { ScanAvailability, ScanErrorCode, ScanListener, ScanProvider } from '@serena/domain';
import { presetParaDuracion, type EscalaEstres } from '../shenai-map.ts';
import { detalleError, fotoSdk, type InformarDiagnostico } from './diagnostico.ts';
import { CANVAS_ID, iniciarSdk, type CredencialEscaneo } from './inicio.ts';
import { calidadActual, crearMedicion } from './medicion.ts';
import type { CrearSdk, ShenaiSdk } from './tipos.ts';

/**
 * Adaptador del SDK de escaneo (Shen.AI Web SDK 3.x en marca blanca). Traduce su API al contrato `ScanProvider`
 * (packages/domain/src/scan.ts). Está partido en unidades, cada una con su responsabilidad:
 *
 *   tipos.ts        la API del SDK que usa SERENA
 *   inicio.ts       descarga, credencial, licencia y cámara
 *   medicion.ts     una medición paso a paso (arranque, progreso, resultado)
 *   diagnostico.ts  lo que se informa al servidor para explicar una falla
 *   ../shenai-map.ts traducción pura de estados y métricas
 *   proveedor.ts    (este archivo) une todo y maneja la cámara y el temporizador
 *
 * El SDK NO está en el repositorio: su licencia comercial no permite usarlo sin contrato. Con el contrato,
 * `npm run scan:vendor -w @serena/web` copia el paquete a public/vendor/shenai (ignorado por git) y se sirve desde
 * el propio origen, que es lo que exige la política de seguridad (CSP) y el aislamiento de origen.
 *
 * Activación (build de la web):
 *   VITE_SCAN_PROVIDER=sdk
 *   y la credencial: por defecto, un token de corta duración que emite el servidor por escaneo (POST /api/escaneo/token,
 *   con SHENAI_ADMIN_KEY en el servidor); la clave permanente no viaja en la app. Solo para pruebas locales:
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

const SDK_URL = (import.meta.env.VITE_SCAN_SDK_URL as string | undefined) || '/vendor/shenai/index.mjs';
const SDK_KEY = (import.meta.env.VITE_SCAN_SDK_KEY as string | undefined) ?? '';
const CADA_MS = 250;

export class SdkScanProvider implements ScanProvider {
  readonly id = 'sdk';
  /** El SDK, solo cuando initialize respondió OK. */
  private sdk: ShenaiSdk | null = null;
  private motor: { cargando: Promise<ShenaiSdk> | null } = { cargando: null };
  /**
   * Inicialización en curso, compartida: la vista previa la empieza y el escaneo la espera. Antes, si la persona
   * tocaba "Empezar" mientras el SDK todavía validaba la licencia (o si había fallado), la medición se lanzaba
   * sobre un SDK sin inicializar y la pantalla quedaba en 1:00 sin aviso.
   */
  private iniciando: Promise<ShenaiSdk | ScanErrorCode> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stream: MediaStream | null = null;
  /** Copia de la pista de la cámara que recibe el SDK (como en el ejemplo WebRTC oficial) y la cámara de origen. */
  private flujoSdk: MediaStream | null = null;
  private origenSdk: MediaStream | null = null;
  /** Diagnóstico de la medición en curso (se informa una vez, al terminar o al salir). */
  private alTerminar: ((motivo: string) => void) | null = null;

  /**
   * @param escalaEstres rango del índice de estrés del SDK (configuración remota escaneo.escalaEstresSdk).
   * @param crear para las pruebas; por defecto importa el SDK servido desde el propio origen.
   * @param diagnostico informa cada inicialización y medición (sin datos de la persona) para diagnosticar en el campo.
   */
  constructor(
    private readonly escalaEstres: EscalaEstres | null,
    private readonly crear: () => Promise<CrearSdk> = async () =>
      ((await import(/* @vite-ignore */ SDK_URL)) as { default: CrearSdk }).default,
    private readonly credencial: CredencialEscaneo = SDK_KEY,
    private readonly diagnostico: InformarDiagnostico = () => undefined,
  ) {}

  async availability(ctx: { online: boolean }): Promise<ScanAvailability> {
    if (!this.credencial) return { disponible: false, motivo: 'sin_licencia' };
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
    // El SDK queda inicializado entre check-ins (reinicializarlo en la misma página no responde): se le pasa la
    // cámara nueva.
    this.conectarCamara(sdk);
    listener(calidadActual(sdk));
    this.cada(() => listener(calidadActual(sdk)));
  }

  async start(opts: { duracionS: number; stream?: MediaStream | null }, listener: ScanListener): Promise<void> {
    // Al repetir una medición, stop() ya soltó la cámara: sin esto el SDK seguía con la pista anterior, ya terminada.
    if (opts.stream) this.stream = opts.stream;
    const sdk = await this.inicializar(listener);
    if (!sdk) return;
    const { validado } = presetParaDuracion(opts.duracionS);
    if (!validado) console.warn(`[serena][escaneo] Medición de ${opts.duracionS} s: el SDK la marca como no validada; usar 60 s.`);
    this.conectarCamara(sdk);
    const t0 = performance.now();
    // Sin esto, "el reloj no arranca" o "no dio resultado" no se pueden explicar desde el servidor.
    const informar = (motivo: string, via: string, resultado = 'MEDICION') =>
      this.diagnostico({ resultado, etapa: 'medicion', ms: Math.round(performance.now() - t0), detalle: `${motivo} · ${this.foto(sdk, via)}` });
    const medicion = crearMedicion({ sdk, escala: this.escalaEstres!, duracionS: opts.duracionS, listener, informar, ahora: () => performance.now() });
    this.alTerminar = (motivo) => informar(motivo, medicion.via());
    this.cada(() => {
      const fin = medicion.paso();
      if (!fin) return;
      if (fin.informado) this.alTerminar = null;
      this.detener();
      this.cerrarMedicion('fin');
      listener(fin.evento);
    });
  }

  /**
   * Termina la medición y libera la copia de la cámara. El SDK queda inicializado (en espera) para el próximo
   * check-in: reinicializarlo en la misma página no respondía (prueba en teléfono del 2026-10-22, SIN_RESPUESTA a
   * los 45 s), y la licencia ya validada sigue sirviendo.
   */
  async stop(): Promise<void> {
    this.detener();
    if (this.sdk?.isInitialized()) this.cerrarMedicion('salida');
    else this.alTerminar = null;
    this.flujoSdk?.getTracks().forEach((t) => t.stop());
    this.flujoSdk = null;
    this.origenSdk = null;
    this.stream = null;
  }

  /**
   * Apaga el SDK por completo (deinitialize) y suelta el motor. Lo usa el módulo en marco antes de descartar su
   * página: quitar un marco con el SDK todavía activo (hilos WASM y lienzo WebGL en uso) hizo caer la pestaña en las
   * pruebas con el SDK real.
   */
  async liberar(): Promise<void> {
    await this.stop();
    const sdk = this.sdk;
    this.sdk = null;
    this.iniciando = null;
    this.motor.cargando = null;
    try {
      if (sdk?.isInitialized()) sdk.deinitialize();
    } catch (e) {
      console.warn('[serena][escaneo] No se pudo apagar el SDK:', detalleError(e));
    }
  }

  /**
   * El SDK listo o null (y emite el error). Una sola inicialización a la vez: si ya hay una en curso, la espera.
   * Si falló, la próxima llamada vuelve a intentar (p. ej. "Reintentar" en la pantalla de luz).
   */
  private async inicializar(listener: ScanListener): Promise<ShenaiSdk | null> {
    if (this.sdk) return this.sdk;
    this.iniciando ??= iniciarSdk({
      motor: this.motor,
      crear: this.crear,
      credencial: this.credencial,
      diagnostico: this.diagnostico,
      stream: this.stream,
      conectarCamara: (sdk) => {
        this.origenSdk = null;
        this.conectarCamara(sdk);
      },
    });
    const r = await this.iniciando;
    if (typeof r === 'string') {
      this.iniciando = null;
      listener({ type: 'error', codigo: r });
      return null;
    }
    this.sdk = r;
    return r;
  }

  private cada(fn: () => void) {
    this.detener();
    this.timer = setInterval(fn, CADA_MS);
  }

  private detener() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Deja el SDK en espera (POSITIONING) sin desinicializarlo e informa cómo terminó la medición. */
  private cerrarMedicion(motivo: string) {
    const sdk = this.sdk;
    if (this.alTerminar) {
      const f = this.alTerminar;
      this.alTerminar = null;
      try {
        f(motivo);
      } catch {
        /* solo diagnóstico */
      }
    }
    if (!sdk) return;
    try {
      if (sdk.setOperatingMode && sdk.OperatingMode?.POSITIONING) sdk.setOperatingMode(sdk.OperatingMode.POSITIONING);
      sdk.stopMeasurement();
    } catch (e) {
      console.warn('[serena][escaneo] No se pudo detener la medición:', detalleError(e));
    }
  }

  private foto(sdk: ShenaiSdk, via: string): string {
    let lienzo: HTMLCanvasElement | null = null;
    try {
      lienzo = document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
    } catch {
      /* solo diagnóstico */
    }
    return fotoSdk(sdk, via, this.flujoSdk?.getVideoTracks()[0], lienzo);
  }

  /**
   * Pasa al SDK una copia de la pista de la cámara (ejemplo WebRTC oficial): la original la siguen usando el video de
   * la pantalla y la medición de luz. Solo si cambió la cámara.
   */
  private conectarCamara(sdk: ShenaiSdk) {
    if (!this.stream || this.origenSdk === this.stream) return;
    const pista = this.stream.getVideoTracks()[0];
    if (!pista || pista.readyState !== 'live') return;
    const anterior = this.flujoSdk;
    const copia = new MediaStream([pista.clone()]);
    sdk.setMediaStream(copia, true);
    this.flujoSdk = copia;
    this.origenSdk = this.stream;
    anterior?.getTracks().forEach((t) => t.stop());
  }
}
