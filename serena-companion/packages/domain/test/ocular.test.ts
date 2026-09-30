import { describe, expect, it } from 'vitest';
import { analizarOcular, applyConsents, type CheckIn, type MuestraOcular } from '../src/index.ts';

const FPS = 30;
const DT = 1000 / FPS;

/**
 * Serie sintética de `seg` segundos a 30 cuadros/s: ojos abiertos (EAR 0,30) salvo en los tramos `cerrado`
 * (EAR 0,08), cabeza estable salvo en los tramos `cabeceo`, y sin rostro en los tramos `sinRostro`.
 */
function serie(seg: number, o: { cerrado?: Array<[number, number]>; cabeceo?: Array<[number, number]>; sinRostro?: Array<[number, number]> } = {}): MuestraOcular[] {
  const dentro = (t: number, tramos: Array<[number, number]> = []) => tramos.some(([a, d]) => t >= a && t < a + d);
  const out: MuestraOcular[] = [];
  for (let t = 0; t < seg * 1000; t += DT) {
    if (dentro(t, o.sinRostro)) out.push({ t, ear: null, inclinacion: null });
    else out.push({ t, ear: dentro(t, o.cerrado) ? 0.08 : 0.3 + ((t / DT) % 3) * 0.002, inclinacion: dentro(t, o.cabeceo) ? 0.62 : 0.5 });
  }
  return out;
}

/** Parpadeos de `ms` cada `cadaMs`, empezando en 1 s. */
const parpadeos = (seg: number, cadaMs: number, ms: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let t = 1000; t < seg * 1000 - 1000; t += cadaMs) out.push([t, ms]);
  return out;
};

describe('indicadores oculares de somnolencia', () => {
  it('ojos abiertos todo el tiempo: PERCLOS 0, sin parpadeos ni cierres largos, lectura válida', () => {
    const r = analizarOcular(serie(60));
    expect(r).toMatchObject({ perclos: 0, parpadeosPorMin: 0, parpadeoMedioMs: null, cierresLargos: 0, cabeceos: 0, cobertura: 1, valido: true });
    expect(r.duracionS).toBeCloseTo(60, 0);
  });

  it('cuenta los parpadeos por minuto y su duración media', () => {
    // Un parpadeo de 150 ms cada 4 s durante 60 s: 15 parpadeos.
    const r = analizarOcular(serie(60, { cerrado: parpadeos(60, 4000, 150) }));
    expect(r.parpadeosPorMin).toBeCloseTo(15, 0);
    expect(r.parpadeoMedioMs).toBeGreaterThanOrEqual(130);
    expect(r.parpadeoMedioMs).toBeLessThanOrEqual(170);
    expect(r.cierresLargos).toBe(0);
  });

  it('PERCLOS es la proporción del tiempo con los ojos cerrados', () => {
    // 6 s cerrados en total sobre 60 s: 10 %.
    const r = analizarOcular(serie(60, { cerrado: [[10_000, 3000], [40_000, 3000]] }));
    expect(r.perclos).toBeCloseTo(0.1, 2);
    expect(r.cierresLargos).toBe(2);
    expect(r.cierreMaxMs).toBeGreaterThanOrEqual(2950);
  });

  it('un cierre de ≥ 500 ms es un cierre largo, no un parpadeo', () => {
    const r = analizarOcular(serie(60, { cerrado: [[20_000, 150], [30_000, 800]] }));
    expect(r.cierresLargos).toBe(1);
    expect(r.parpadeoMedioMs).not.toBeNull();
    expect(r.cierreMaxMs).toBeGreaterThanOrEqual(780);
  });

  it('la apertura se toma de la propia persona: ojos más chicos no cuentan como cerrados', () => {
    const chicos = serie(60).map((s) => ({ ...s, ear: s.ear === null ? null : s.ear * 0.6 }));
    expect(analizarOcular(chicos).perclos).toBe(0);
  });

  it('detecta cabeceos breves y no confunde una postura sostenida con un cabeceo', () => {
    expect(analizarOcular(serie(60, { cabeceo: [[15_000, 800], [35_000, 1200]] })).cabeceos).toBe(2);
    expect(analizarOcular(serie(60, { cabeceo: [[10_000, 10_000]] })).cabeceos).toBe(0);
  });

  it('sin rostro no se supone ojo cerrado, y con poca cobertura la lectura no es válida', () => {
    const r = analizarOcular(serie(60, { sinRostro: [[10_000, 30_000]] }));
    expect(r.perclos).toBe(0);
    expect(r.cobertura).toBeCloseTo(0.5, 1);
    expect(r.valido).toBe(false);
    expect(analizarOcular(serie(15)).valido).toBe(false);
    expect(analizarOcular([]).valido).toBe(false);
  });

  it('con pocos cuadros por segundo (equipo sin GPU) la lectura no es válida', () => {
    const lenta = serie(60).filter((_, i) => i % 3 === 0); // 10 cuadros/s
    const r = analizarOcular(lenta);
    expect(r.cuadrosPorS).toBeCloseTo(10, 0);
    expect(r.valido).toBe(false);
    expect(analizarOcular(serie(60)).cuadrosPorS).toBeCloseTo(30, 0);
  });

  it('el consentimiento de cámara cubre también los indicadores oculares', () => {
    const c = {
      id: 'c',
      userId: 'u',
      deviceId: 'd',
      deviceName: 'Tel',
      deviceKind: 'mobile',
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T10:00:00.000Z',
      rosterDay: 1,
      onShift: true,
      animo: 2,
      sueno: 2,
      escaneo: null,
      ocular: analizarOcular(serie(60)),
      reaccion: null,
      voz: null,
      nivel: 'bajo',
      nota: null,
    } satisfies CheckIn;
    const d = applyConsents(c, { camara: false, animo: true, reaccion: true, chat: true, geo: false });
    expect(d.ok && d.checkin.ocular).toBeNull();
    expect(d.ok && d.quitados).toContain('camara');
  });
});
