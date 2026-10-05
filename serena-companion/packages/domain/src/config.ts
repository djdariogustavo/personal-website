import { PARAMETROS_OCULAR, type ParametrosOcular } from './ocular.ts';
/**
 * Configuración remota. Todo lo que el handoff marca como "se calibra en el trial
 * de 30 días" o "configurable por faena" vive acá y lo sirve el servidor en
 * GET /api/config. Los valores por defecto son PROVISORIOS.
 */

export interface LightThresholds {
  /** Luminancia media (0–255) de la región del rostro por debajo de la cual la luz es insuficiente. */
  insuficienteBajo: number;
  /** Por debajo de este valor (y sobre el anterior) la luz es "justa". */
  justaBajo: number;
  /** Por encima de este valor hay sobreexposición (se trata como "justa"). */
  sobreexpuesta: number;
  /** Relación fondo / rostro a partir de la cual se considera contraluz. */
  contraluzRatio: number;
  /** Diferencia media entre cuadros (0–255) a partir de la cual hay movimiento. */
  movimiento: number;
  /** Lux del sensor de luz ambiente (si existe) para considerar insuficiente / justa. */
  luxInsuficiente: number;
  luxJusta: number;
}

export interface LevelThresholds {
  /** Índice de estrés (1–5) desde el cual el nivel es moderado. */
  estresModerado: number;
  /** Índice de estrés (1–5) desde el cual el nivel es alto. */
  estresAlto: number;
  /** Puntaje de autorreporte (0–1) desde el cual el nivel es moderado. */
  autorreporteModerado: number;
  /** Tiempo medio de reacción (ms) desde el cual suma fatiga. */
  reaccionLentaMs: number;
  /**
   * Si es false, el autorreporte solo nunca produce nivel alto (evita escalamientos
   * por un toque equivocado). Recomendado: false hasta terminar el trial.
   */
  autorreportePuedeSerAlto: boolean;
}

export interface Helpline {
  nombre: string;
  numero: string;
  /** false = número todavía sin verificar para esta faena (ver docs/PENDIENTES.md). */
  verificado: boolean;
}

export interface RemoteConfig {
  version: string;
  escaneo: {
    /**
     * Duración del escaneo en segundos. El SDK solo valida la medición de 60 s (las de 30 y 45 s figuran como
     * no validadas), así que 60 es el valor por defecto.
     */
    duracionS: 30 | 45 | 60;
    /** Disponibilidad del SDK por contexto. Se completa al confirmar P1/P2 con el proveedor. */
    disponibleEn: Record<'mobile' | 'tablet' | 'desktop' | 'kiosk', boolean>;
    /** P1: si el SDK funciona sin conexión. */
    offline: boolean;
    /**
     * Rango del índice de estrés del SDK que se lleva a la escala 1–5 de SERENA. Shen.AI documenta un Stress Index
     * (Baevsky modificado) de 0 a 10: 0–4 normal, > 5 estrés alto, > 9 estado crítico (developer.shen.ai,
     * "Video measurement → Results"). Con null el escaneo con el SDK real queda deshabilitado.
     */
    escalaEstresSdk: { min: number; max: number } | null;
  };
  luz: LightThresholds;
  /**
   * Indicadores oculares de somnolencia durante el escaneo (MODO REGISTRO: no afectan el nivel). Apagado por
   * defecto; se enciende para el piloto de evaluación clínica.
   */
  ocular: { habilitado: boolean } & ParametrosOcular;
  niveles: LevelThresholds;
  resultadoAlto: {
    /** Segundos de la cuenta regresiva antes de conectar con la guardia. */
    cuentaS: number;
  };
  sesion: {
    /** Minutos de inactividad antes de cerrar la sesión. */
    inactividadMin: Record<'mobile' | 'tablet' | 'desktop' | 'kiosk', number>;
    kioscoCierreS: number;
  };
  lineasAyuda: Record<'AR' | 'CL', Helpline[]>;
  guardia: {
    /** Descripción del canal de la guardia (PEC) para mostrar al trabajador. */
    canal: string;
    radio: string;
  };
  politicaUrl: string;
  ayudaConfidencialUrl: string;
}

export const DEFAULT_CONFIG: RemoteConfig = {
  version: '2026-09-provisorio',
  escaneo: {
    duracionS: 60,
    disponibleEn: { mobile: true, tablet: true, desktop: true, kiosk: true },
    offline: false,
    escalaEstresSdk: { min: 0, max: 10 },
  },
  luz: {
    insuficienteBajo: 60,
    justaBajo: 95,
    sobreexpuesta: 225,
    contraluzRatio: 1.6,
    movimiento: 14,
    luxInsuficiente: 50,
    luxJusta: 150,
  },
  ocular: { habilitado: false, ...PARAMETROS_OCULAR },
  niveles: {
    estresModerado: 2.6,
    estresAlto: 4.2,
    autorreporteModerado: 0.55,
    reaccionLentaMs: 450,
    autorreportePuedeSerAlto: false,
  },
  resultadoAlto: { cuentaS: 15 },
  sesion: {
    inactividadMin: { mobile: 15, tablet: 5, desktop: 15, kiosk: 5 },
    kioscoCierreS: 20,
  },
  lineasAyuda: {
    AR: [
      { nombre: 'Emergencias', numero: '911', verificado: false },
      { nombre: 'Centro de Asistencia al Suicida', numero: '135', verificado: false },
    ],
    CL: [
      { nombre: 'SAMU', numero: '131', verificado: false },
      { nombre: 'Línea de prevención', numero: '*4141', verificado: false },
    ],
  },
  guardia: {
    canal: 'Guardia de faena (PEC)',
    radio: 'Guardia de faena por radio, canal de emergencia',
  },
  politicaUrl: '/privacidad/politica',
  ayudaConfidencialUrl: '/recursos/alcohol-y-descanso#ayuda',
};
