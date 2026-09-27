/**
 * Tipos compartidos entre la app (web/PWA) y el servidor.
 * Los nombres siguen el vocabulario del handoff de diseño (§ State Management).
 */

export type DeviceKind = 'mobile' | 'tablet' | 'desktop' | 'kiosk';

export type Role = 'worker' | 'admin';

/** Nivel del resultado. Nunca se muestra con lenguaje clínico. */
export type Level = 'bajo' | 'moderado' | 'alto';

/** Índices de las escalas del check-in (paso 1). */
export const MOOD_OPTIONS = ['Muy bien', 'Bien', 'Más o menos', 'Cansado', 'Muy cansado'] as const;
export const SLEEP_OPTIONS = ['Menos de 4 h', '4 a 6 h', '6 a 8 h', 'Más de 8 h'] as const;
export type MoodIndex = 0 | 1 | 2 | 3 | 4;
export type SleepIndex = 0 | 1 | 2 | 3;

export interface ScanMetrics {
  /** Frecuencia cardíaca, latidos por minuto. */
  pulso: number;
  /** Variabilidad de la frecuencia cardíaca (HRV), ms. */
  hrv: number;
  /** Frecuencia respiratoria, respiraciones por minuto. */
  respiracion: number;
  /** Índice de estrés, escala 1–5. */
  estres: number;
}

export interface ScanResult {
  metricas: ScanMetrics;
  /** Calidad global de la lectura informada por el SDK, 0–1. */
  calidad: number;
  duracionS: number;
}

export interface ReactionResult {
  toques: number;
  /** Tiempo medio de reacción en ms. */
  mediaMs: number;
  /** Toques fuera de tiempo (anticipados). */
  anticipados: number;
}

export interface VoiceResult {
  /** Duración de la lectura en segundos. El audio nunca se guarda ni se envía. */
  duracionS: number;
  /** Nivel RMS medio normalizado 0–1 (solo para saber que hubo lectura). */
  nivelMedio: number;
}

export interface CheckIn {
  id: string;
  userId: string;
  /** Dispositivo donde se hizo (id del registro de dispositivo). */
  deviceId: string;
  deviceName: string;
  deviceKind: DeviceKind;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601, usado para resolver conflictos
  rosterDay: number | null;
  onShift: boolean;
  animo: MoodIndex | null;
  sueno: SleepIndex | null;
  escaneo: ScanResult | null;
  reaccion: ReactionResult | null;
  voz: VoiceResult | null;
  nivel: Level;
  nota: string | null;
  deleted?: boolean;
}

export interface Consents {
  camara: boolean;
  animo: boolean;
  reaccion: boolean;
  chat: boolean;
  geo: boolean;
}

export const DEFAULT_CONSENTS: Consents = {
  camara: true,
  animo: true,
  reaccion: true,
  chat: true,
  geo: true,
};

export type SyncState = 'ok' | 'sincronizando' | 'pendiente' | 'offline';

export interface ChatMessage {
  id: string;
  role: 'user' | 'companion';
  text: string;
  createdAt: string;
}

export type EmergencyType = 'fisica' | 'hablar' | 'riesgo';

export interface EmergencyRequest {
  id: string;
  tipo: EmergencyType;
  compartirUbicacion: boolean;
  ubicacion?: { lat: number; lng: number; precisionM: number } | null;
  creadoEn: string; // hora del dispositivo, se conserva aunque se envíe tarde
  origen: 'boton' | 'resultado_alto' | 'acompanante';
}

export interface EmergencyAck {
  id: string;
  estado: 'enviado';
  canal: string;
  recibidoEn: string;
}

export interface UserProfile {
  id: string;
  nombre: string;
  nombreCorto: string;
  iniciales: string;
  puesto: string;
  role: Role;
  org: {
    id: string;
    nombre: string;
    faena: string;
    pais: 'AR' | 'CL';
  };
  roster: {
    /** Fecha (YYYY-MM-DD) del día 1 del ciclo de trabajo vigente. */
    inicio: string;
    diasTrabajo: number;
    diasDescanso: number;
    turno: 'dia' | 'noche';
  };
  consents: Consents;
}

export interface DeviceInfo {
  id: string;
  kind: DeviceKind;
  nombre: string;
  sistema: string;
  efimero: boolean;
  ultimaSync: string | null;
  actual: boolean;
  cerrado: boolean;
}
