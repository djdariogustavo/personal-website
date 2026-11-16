import type { ScanAvailability, ScanEvent, ScanListener, ScanProvider } from '@serena/domain';
import { MARCO_URL, MARCO_VERSION, type ModuloEscaneo, type OpcionesModuloEscaneo, type ProveedorEnMarco } from './contrato.ts';

/** Tope para que la página del módulo cargue y publique su contrato. */
export const MARCO_TOPE_MS = 20_000;

/** Tiempo entre apagar el SDK y quitar su marco. */
export const ESPERA_DESCARTE_MS = 1_000;

/** Un marco cargado: el módulo que publicó y cómo descartarlo. */
export interface MarcoCargado {
  modulo: ModuloEscaneo | undefined;
  descartar(): void;
}

/** Carga la página del módulo en un marco oculto del mismo origen. Rechaza si no carga a tiempo. */
export function cargarMarco(url: string = MARCO_URL): Promise<MarcoCargado> {
  return new Promise((listo, falla) => {
    const marco = document.createElement('iframe');
    marco.src = url;
    marco.title = 'Módulo de escaneo';
    marco.setAttribute('aria-hidden', 'true');
    marco.tabIndex = -1;
    marco.allow = 'camera; cross-origin-isolated';
    // Fuera de pantalla pero con tamaño: un marco con display:none no dibuja y el SDK necesita su lienzo activo.
    Object.assign(marco.style, { position: 'fixed', left: '-10000px', top: '0', width: '480px', height: '640px', border: '0', opacity: '0', pointerEvents: 'none' });
    const descartar = () => marco.remove();
    const tope = setTimeout(() => {
      descartar();
      falla(new Error(`el módulo de escaneo no cargó en ${MARCO_TOPE_MS / 1000} s`));
    }, MARCO_TOPE_MS);
    marco.addEventListener('load', () => {
      clearTimeout(tope);
      let modulo: ModuloEscaneo | undefined;
      try {
        modulo = marco.contentWindow?.serenaEscaneo;
      } catch {
        /* otro origen o página de error: se trata como módulo ausente */
      }
      listo({ modulo, descartar });
    });
    marco.addEventListener('error', () => {
      clearTimeout(tope);
      descartar();
      falla(new Error('el módulo de escaneo no cargó'));
    });
    document.body.appendChild(marco);
  });
}

/**
 * Proveedor de escaneo que usa el SDK alojado en un marco (ver ./contrato.ts). Para la app es un `ScanProvider`
 * más: carga el marco cuando hace falta, le pasa cada pedido y lo descarta después de una medición o de un error,
 * de modo que el siguiente intento siempre arranca con un SDK nuevo.
 */
export class MarcoScanProvider implements ScanProvider {
  readonly id = 'sdk-marco';
  private marco: Promise<{ interno: ProveedorEnMarco; descartar: () => void }> | null = null;
  /** Hubo una medición o un error: al detener (o en el próximo pedido) se descarta el marco. */
  private gastado = false;

  constructor(
    private readonly opciones: OpcionesModuloEscaneo,
    private readonly cargar: () => Promise<MarcoCargado> = cargarMarco,
  ) {}

  async availability(ctx: { online: boolean }): Promise<ScanAvailability> {
    try {
      return await (await this.interno()).availability(ctx);
    } catch (e) {
      this.informarFalla(e);
      return { disponible: false, motivo: ctx.online ? 'no_soportado' : 'sin_conexion' };
    }
  }

  async mountPreview(container: HTMLElement, stream: MediaStream | null, listener: ScanListener): Promise<void> {
    const interno = await this.internoO(listener);
    await interno?.mountPreview(container, stream, this.escuchar(listener));
  }

  async start(opts: { duracionS: number; stream?: MediaStream | null }, listener: ScanListener): Promise<void> {
    const interno = await this.internoO(listener);
    if (!interno) return;
    this.gastado = true;
    await interno.start(opts, this.escuchar(listener));
  }

  async stop(): Promise<void> {
    const actual = this.marco;
    if (!actual) return;
    try {
      await (await actual).interno.stop();
    } catch {
      /* el marco ya no está: no hay nada que detener */
    }
    if (this.gastado && this.marco === actual) this.descartar();
  }

  /** El proveedor del marco actual; si el anterior quedó gastado, se descarta y se carga uno nuevo. */
  private async interno(): Promise<ScanProvider> {
    if (this.gastado) this.descartar();
    this.marco ??= this.cargar().then(({ modulo, descartar }) => {
      if (!modulo || typeof modulo.crear !== 'function' || modulo.version !== MARCO_VERSION) {
        descartar();
        throw new Error(modulo ? `versión del módulo de escaneo ${modulo.version}, se esperaba ${MARCO_VERSION}` : 'la página no publicó el módulo de escaneo');
      }
      return { interno: modulo.crear(this.opciones), descartar };
    });
    try {
      return (await this.marco).interno;
    } catch (e) {
      this.marco = null;
      throw e;
    }
  }

  /** Como `interno`, pero una falla al cargar el marco se emite como error del escaneo. */
  private async internoO(listener: ScanListener): Promise<ScanProvider | null> {
    try {
      return await this.interno();
    } catch (e) {
      this.informarFalla(e);
      listener({ type: 'error', codigo: 'no_soportado' });
      return null;
    }
  }

  /** Copia cada evento a este lado (el objeto original pertenece al marco) y anota si hubo un error. */
  private escuchar(listener: ScanListener): ScanListener {
    return (e) => {
      if (e.type === 'error') this.gastado = true;
      listener(structuredClone(e) as ScanEvent);
    };
  }

  /** Apaga el SDK del marco actual y recién después quita su página (quitarla con el SDK activo hizo caer la pestaña). */
  private descartar() {
    const actual = this.marco;
    this.marco = null;
    this.gastado = false;
    void actual
      ?.then(async (m) => {
        try {
          await m.interno.liberar();
        } catch {
          /* el marco ya no responde: se quita igual */
        }
        // Un respiro para que el SDK termine de cerrar sus hilos antes de destruir el documento.
        setTimeout(m.descartar, ESPERA_DESCARTE_MS);
      })
      .catch(() => undefined);
  }

  private informarFalla(e: unknown) {
    const detalle = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    console.error('[serena][escaneo] No se pudo cargar el módulo de escaneo:', detalle);
    this.opciones.diagnostico({ resultado: 'MARCO_FALLIDO', etapa: 'importar', ms: 0, detalle });
  }
}
