/**
 * Contrato del slot de escaneo NeuroSentinel™.
 *
 * El SDK de lectura de signos vitales por cámara (Shen.AI, marca blanca) todavía
 * no está disponible. La interfaz espera exactamente estos eventos (handoff,
 * "Contrato de eventos que espera la UI"). Cuando llegue el SDK, se implementa
 * un adaptador `ScanProvider` que traduce sus callbacks a estos eventos y se
 * registra en apps/web/src/scan/registry.ts. Ninguna pantalla cambia.
 *
 * Regla de marca: la UI nunca muestra el nombre del proveedor.
 */
import type { ScanMetrics, ScanResult } from './types.ts';

export type LightLevel = 'insuficiente' | 'justa' | 'optima';

export interface QualityEvent {
  type: 'calidad';
  luz: LightLevel;
  rostroCentrado: boolean;
  movimiento: boolean;
  contraluz: boolean;
}

export interface ProgressEvent {
  type: 'progreso';
  /** 0–1 */
  valor: number;
}

export interface MetricEvent {
  type: 'metrica';
  nombre: keyof ScanMetrics;
  valor: number;
  estable: boolean;
}

export interface SignalLostEvent {
  type: 'senal_perdida';
  motivo: 'movimiento' | 'luz' | 'rostro';
}

export interface CompleteEvent {
  type: 'completo';
  resultado: ScanResult;
}

export type ScanErrorCode = 'sin_permiso' | 'sin_camara' | 'no_soportado' | 'sin_licencia' | 'sin_conexion';

export interface ErrorEvent {
  type: 'error';
  codigo: ScanErrorCode;
}

export type ScanEvent = QualityEvent | ProgressEvent | MetricEvent | SignalLostEvent | CompleteEvent | ErrorEvent;

export type ScanListener = (e: ScanEvent) => void;

export interface ScanAvailability {
  disponible: boolean;
  motivo?: ScanErrorCode;
}

/**
 * Adaptador del SDK. Se monta en dos slots: la vista de cámara (6.6) y el óvalo
 * de escaneo (6.7). Ambos reciben el mismo `HTMLElement` contenedor.
 */
export interface ScanProvider {
  readonly id: string;
  /** Verifica licencia, soporte del navegador/dispositivo y (si aplica) conexión. */
  availability(ctx: { online: boolean }): Promise<ScanAvailability>;
  /** Monta la vista previa de la cámara y empieza a emitir eventos `calidad`. */
  mountPreview(container: HTMLElement, stream: MediaStream | null, listener: ScanListener): Promise<void>;
  /** Comienza la medición. Emite `progreso`, `metrica`, `senal_perdida`, `completo` o `error`. */
  start(opts: { duracionS: number }, listener: ScanListener): Promise<void>;
  /** Detiene y libera todo. Debe garantizar que no queda ningún cuadro en memoria. */
  stop(): Promise<void>;
}

export const METRIC_LABELS: Record<keyof ScanMetrics, { label: string; unidad: string; decimales: number }> = {
  pulso: { label: 'Pulso', unidad: 'lpm', decimales: 0 },
  hrv: { label: 'Variabilidad', unidad: 'ms', decimales: 0 },
  respiracion: { label: 'Respiración', unidad: 'rpm', decimales: 0 },
  estres: { label: 'Estrés', unidad: 'de 5', decimales: 1 },
};
