import type { CondicionSdk, EstadoMedicionSdk, ResultadosSdk } from '../shenai-map.ts';

/**
 * Tipos del SDK de escaneo (Shen.AI Web SDK 3.x): solo el subconjunto de su API que usa SERENA. Es la única
 * descripción del SDK en el proyecto; si el proveedor cambia su API, se corrige acá y en ../shenai-map.ts.
 */
export interface EnumSdk {
  readonly value: number;
}
export type Enums<K extends string> = Record<K, EnumSdk>;

export interface ShenaiSdk {
  initialize(apiKey: string, userId: string, settings: Record<string, unknown>, onResult: (r: EnumSdk) => void): void;
  deinitialize(): void;
  isInitialized(): boolean;
  attachToCanvas(selector: string, exclusive?: boolean): void;
  setMediaStream(stream: MediaStream, facingUser?: boolean): void;
  setRecordingEnabled(enabled: boolean): void;
  startMeasurement(): void;
  stopMeasurement(): void;
  /** POSITIONING: el SDK mira la cámara sin medir. MEASURE: mide (así lo arrancan los ejemplos oficiales 3.x). */
  setOperatingMode?(mode: EnumSdk): void;
  getOperatingMode?(): EnumSdk;
  getMeasurementState(): EnumSdk;
  getMeasurementProgressPercentage(): number;
  /** El SDK solo mide con licencia activa y modelos descargados; antes de eso ignora el pedido de medir. */
  isReadyToStartMeasurement?(): boolean;
  getRequiredModelsDownloadProgressPercentage?(): number;
  getFaceState(): EnumSdk;
  /** Plan de la licencia (algunos planes no calculan todas las métricas). */
  getPricingPlan?(): string;
  isGeneralWellnessSdk?(): boolean;
  getCurrentViolatedMeasurementEnvironmentCondition(): EnumSdk | null;
  getRealtimeMetrics(periodSec: number): ResultadosSdk | null;
  getMeasurementResults(): ResultadosSdk | null;
  getLastCameraError(): EnumSdk | null;
  InitializationResult: Enums<'OK' | 'INVALID_API_KEY' | 'CONNECTION_ERROR' | 'INTERNAL_ERROR'>;
  MeasurementState: Enums<EstadoMedicionSdk>;
  MeasurementEnvironmentCondition: Enums<CondicionSdk>;
  FaceState: Enums<'OK' | 'TOO_FAR' | 'TOO_CLOSE' | 'NOT_CENTERED' | 'NOT_VISIBLE' | 'TURNED_AWAY' | 'UNKNOWN'>;
  CameraMode: Enums<'FACING_USER' | 'MEDIA_STREAM' | 'OFF'>;
  CameraError: Enums<'PERMISSION_NOT_GRANTED' | 'NO_CAMERA_DEVICE'>;
  MeasurementPreset: Enums<'ONE_MINUTE_HR_HRV_BR' | 'CUSTOM'>;
  PrecisionMode: Enums<'STRICT'>;
  OnboardingMode: Enums<'HIDDEN'>;
  OperatingMode?: Enums<'POSITIONING' | 'MEASURE' | 'SYSTEM_OVERLOADED'>;
}

/** Función que exporta el paquete del SDK (index.mjs) para crear el motor. */
export type CrearSdk = (args: Record<string, unknown>) => Promise<ShenaiSdk>;

/**
 * Nombre del valor de un enum del SDK (los enums son objetos con `value`).
 *
 * Los enums del SDK real (embind) tienen, además de sus valores, propiedades internas propias y enumerables:
 * `values` (un objeto sin `value`) y otra de nombre minificado que vale `undefined` (en 3.1.15, `Xi`). Leer
 * `.value` de todas las claves rompía con "Cannot read properties of undefined (reading 'value')" justo al recibir
 * el resultado de la licencia (prueba en teléfono del 2026-10-22). Solo cuentan los miembros con `value` numérico.
 */
export function nombre<K extends string>(e: Enums<K>, v: EnumSdk | null | undefined): K | null {
  if (!v || typeof v.value !== 'number') return null;
  for (const k of Object.keys(e ?? {})) {
    const miembro = (e as Record<string, unknown>)[k] as { value?: unknown } | null | undefined;
    if (miembro && typeof miembro === 'object' && typeof miembro.value === 'number' && miembro.value === v.value) return k as K;
  }
  return null;
}
