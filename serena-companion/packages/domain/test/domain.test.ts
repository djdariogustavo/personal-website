import { describe, expect, it } from 'vitest';
import {
  assessLight,
  classify,
  DEFAULT_CONFIG,
  detectRisk,
  frameStats,
  motionBetween,
  rosterInsight,
  rosterStatus,
  wins,
  type CheckIn,
} from '../src/index.ts';

const T = DEFAULT_CONFIG.niveles;

describe('roster', () => {
  const cfg = { inicio: '2026-09-01', diasTrabajo: 14, diasDescanso: 14 };
  it('calcula el día de trabajo y de descanso', () => {
    expect(rosterStatus(cfg, new Date(2026, 8, 9))).toMatchObject({ enTurno: true, dia: 9, total: 14 });
    expect(rosterStatus(cfg, new Date(2026, 8, 17))).toMatchObject({ enTurno: false, dia: 3, total: 14 });
    expect(rosterStatus(cfg, new Date(2026, 8, 29))).toMatchObject({ enTurno: true, dia: 1 });
    // Fechas anteriores al ancla también funcionan.
    expect(rosterStatus(cfg, new Date(2026, 7, 31))).toMatchObject({ enTurno: false, dia: 14 });
  });
});

describe('niveles', () => {
  const scan = (estres: number) => ({ metricas: { pulso: 70, hrv: 50, respiracion: 14, estres }, calidad: 1, duracionS: 45 });
  it('clasifica por índice de estrés', () => {
    expect(classify({ animo: 1, sueno: 2, escaneo: scan(1.8), reaccion: null }, T)).toBe('bajo');
    expect(classify({ animo: 1, sueno: 2, escaneo: scan(3.1), reaccion: null }, T)).toBe('moderado');
    expect(classify({ animo: 1, sueno: 2, escaneo: scan(4.5), reaccion: null }, T)).toBe('alto');
  });
  it('el autorreporte solo nunca escala a alto con la configuración por defecto', () => {
    expect(classify({ animo: 4, sueno: 0, escaneo: null, reaccion: null }, T)).toBe('moderado');
    expect(classify({ animo: 4, sueno: 0, escaneo: null, reaccion: null }, { ...T, autorreportePuedeSerAlto: true })).toBe('alto');
  });
  it('una reacción lenta sugiere una pausa', () => {
    expect(classify({ animo: 0, sueno: 2, escaneo: null, reaccion: { toques: 10, mediaMs: 520, anticipados: 0 } }, T)).toBe('moderado');
  });
});

describe('luz', () => {
  function frame(face: number, bg: number, w = 64, h = 80) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x / w - 0.5) / 0.26;
        const dy = (y / h - 0.41) / 0.29;
        const v = dx * dx + dy * dy <= 1 ? face : bg;
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    return frameStats(d, w, h);
  }
  const L = DEFAULT_CONFIG.luz;
  it('distingue insuficiente, justa y óptima', () => {
    expect(assessLight(frame(30, 30), 0, L).luz).toBe('insuficiente');
    expect(assessLight(frame(80, 70), 0, L).luz).toBe('justa');
    expect(assessLight(frame(140, 120), 0, L).luz).toBe('optima');
  });
  it('detecta contraluz', () => {
    const a = assessLight(frame(110, 240), 0, L);
    expect(a.contraluz).toBe(true);
    expect(a.luz).toBe('justa');
  });
  it('el sensor de luz ambiente solo puede empeorar el resultado', () => {
    expect(assessLight(frame(140, 120), 0, L, 20).luz).toBe('insuficiente');
    expect(assessLight(frame(30, 30), 0, L, 5000).luz).toBe('insuficiente');
  });
  it('detecta movimiento entre cuadros', () => {
    const a = frame(140, 120).miniatura;
    const b = frame(60, 200).miniatura;
    expect(motionBetween(a, a)).toBe(0);
    expect(assessLight({ rostro: 140, fondo: 120 }, motionBetween(a, b), L).movimiento).toBe(true);
  });
});

describe('riesgo', () => {
  it('detecta expresiones de daño', () => {
    expect(detectRisk('A veces pienso que no quiero seguir. Que sería más fácil hacerme daño.')).toBe('alto');
    expect(detectRisk('me quiero morir')).toBe('alto');
    expect(detectRisk('Pienso en SUICIDARME')).toBe('alto');
  });
  it('marca posible riesgo en desesperanza intensa', () => {
    expect(detectRisk('Estoy en el día 9 y ya no doy más, extraño a mis hijos.')).toBe('posible');
  });
  it('no marca conversaciones comunes', () => {
    expect(detectRisk('Estoy cansado')).toBe('ninguno');
    expect(detectRisk('No puedo dormir de día')).toBe('ninguno');
  });
});

describe('sincronización', () => {
  it('gana la más reciente y desempata por dispositivo', () => {
    expect(wins({ updatedAt: '2026-09-01T10:00:00Z', deviceId: 'a' }, { updatedAt: '2026-09-01T09:00:00Z', deviceId: 'b' })).toBe(true);
    expect(wins({ updatedAt: '2026-09-01T08:00:00Z', deviceId: 'z' }, { updatedAt: '2026-09-01T09:00:00Z', deviceId: 'b' })).toBe(false);
    expect(wins({ updatedAt: '2026-09-01T09:00:00Z', deviceId: 'c' }, { updatedAt: '2026-09-01T09:00:00Z', deviceId: 'b' })).toBe(true);
    expect(wins({ updatedAt: '2026-09-01T09:00:00Z', deviceId: 'a' }, { updatedAt: '2026-09-01T09:00:00Z', deviceId: 'b' })).toBe(false);
  });
});

describe('insight', () => {
  it('pide más datos si hay pocos check-ins', () => {
    expect(rosterInsight([], 14).suficiente).toBe(false);
  });
  it('encuentra el día desde el que sube el cansancio', () => {
    const cs: CheckIn[] = [];
    for (let r = 0; r < 2; r++)
      for (let d = 1; d <= 14; d++)
        cs.push({
          id: `${r}-${d}`,
          userId: 'u',
          deviceId: 'd',
          deviceName: '',
          deviceKind: 'mobile',
          createdAt: '',
          updatedAt: '',
          rosterDay: d,
          onShift: true,
          animo: null,
          sueno: null,
          escaneo: { metricas: { pulso: 70, hrv: 50, respiracion: 14, estres: d >= 10 ? 4 : 2 }, calidad: 1, duracionS: 45 },
          reaccion: null,
          voz: null,
          nivel: 'bajo',
          nota: null,
        });
    const i = rosterInsight(cs, 14);
    expect(i.suficiente).toBe(true);
    expect(i.texto).toContain('a partir del día 10');
    expect(i.texto).toContain('desde el día 8');
  });
});
