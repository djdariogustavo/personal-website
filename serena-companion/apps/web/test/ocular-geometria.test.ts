import { describe, expect, it } from 'vitest';
import { earOjo, earPromedio, inclinacion, MENTON, NARIZ, FRENTE, OJO_DERECHO, OJO_IZQUIERDO, type Punto } from '../src/ocular/geometria.ts';

/**
 * Rostro sintético en coordenadas normalizadas: cada ojo mide `ancho` de comisura a comisura y se abre `apertura`
 * (en píxeles), sobre un video de w × h.
 */
function rostro(apertura: number, o: { w?: number; h?: number; nariz?: number } = {}): { lm: Punto[]; w: number; h: number } {
  const w = o.w ?? 640;
  const h = o.h ?? 480;
  const lm: Punto[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const ancho = 60; // px
  const ojo = (idx: readonly number[], cx: number) => {
    const [p1, p2, p3, p4, p5, p6] = idx;
    const cy = 200;
    const at = (x: number, y: number) => ({ x: x / w, y: y / h });
    lm[p1!] = at(cx - ancho / 2, cy);
    lm[p4!] = at(cx + ancho / 2, cy);
    lm[p2!] = at(cx - 10, cy - apertura / 2);
    lm[p3!] = at(cx + 10, cy - apertura / 2);
    lm[p6!] = at(cx - 10, cy + apertura / 2);
    lm[p5!] = at(cx + 10, cy + apertura / 2);
  };
  ojo(OJO_DERECHO, 250);
  ojo(OJO_IZQUIERDO, 390);
  lm[FRENTE] = { x: 0.5, y: 100 / h };
  lm[MENTON] = { x: 0.5, y: 400 / h };
  lm[NARIZ] = { x: 0.5, y: (o.nariz ?? 250) / h };
  return { lm, w, h };
}

describe('geometría del ojo (EAR)', () => {
  it('EAR = apertura / ancho del ojo: abierto ≈ 0,3 y cerrado cerca de 0', () => {
    const abierto = rostro(18);
    expect(earOjo(abierto.lm, OJO_DERECHO, abierto.w, abierto.h)).toBeCloseTo(0.3, 5);
    const cerrado = rostro(3);
    expect(earPromedio(cerrado.lm, cerrado.w, cerrado.h)).toBeCloseTo(0.05, 5);
  });

  it('no depende de la relación de aspecto del video', () => {
    const a = rostro(18, { w: 640, h: 480 });
    const b = rostro(18, { w: 1280, h: 720 });
    expect(earPromedio(b.lm, b.w, b.h)).toBeCloseTo(earPromedio(a.lm, a.w, a.h)!, 5);
  });

  it('sin puntos no inventa un valor', () => {
    expect(earPromedio([], 640, 480)).toBeNull();
    expect(inclinacion([], 640, 480)).toBeNull();
  });
});

describe('inclinación de la cabeza', () => {
  it('sube cuando la nariz se acerca al mentón (cabeza hacia adelante)', () => {
    const recta = rostro(18, { nariz: 250 });
    const caida = rostro(18, { nariz: 290 });
    expect(inclinacion(recta.lm, recta.w, recta.h)).toBeCloseTo(0.5, 5);
    expect(inclinacion(caida.lm, caida.w, caida.h)!).toBeGreaterThan(inclinacion(recta.lm, recta.w, recta.h)!);
  });
});
