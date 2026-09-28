import { describe, expect, it } from 'vitest';
import { publicarDistribucion, redondear, ultimoPorPersona, ventanaReporte, type Level } from '../src/index.ts';

const g = (s: string): Level[] => [...s].map((c) => (c === 'b' ? 'bajo' : c === 'm' ? 'moderado' : 'alto'));

describe('control de divulgación de reportes', () => {
  it('oculta grupos de menos de 5 personas', () => {
    expect(publicarDistribucion(g('bbbm'))).toEqual({ personas: null, distribucion: null, motivo: 'grupo_chico' });
  });

  it('una sola persona en alto no se publica como celda propia: se agrupa con moderado', () => {
    const r = publicarDistribucion(g('bbbmma'));
    expect(r.distribucion).toEqual({ tipo: 'agrupada', bajo: 0.5, atencion: 0.5 });
  });

  it('si la celda agrupada sigue siendo chica, no se publica la distribución', () => {
    expect(publicarDistribucion(g('bbbba')).motivo).toBe('celda_chica');
    expect(publicarDistribucion(g('bbbbbbma')).motivo).toBe('celda_chica');
  });

  it('tampoco se publica si quedan 1 o 2 personas en "bien" (el resto quedaría expuesto)', () => {
    expect(publicarDistribucion(g('bbmmmaaa')).motivo).toBe('celda_chica');
  });

  it('un grupo homogéneo en atención no se publica', () => {
    expect(publicarDistribucion(g('mmmaa')).motivo).toBe('homogeneo');
    expect(publicarDistribucion(g('aaaaa')).motivo).toBe('homogeneo');
  });

  it('todos en "bien" sí se publica (no revela nada sensible)', () => {
    expect(publicarDistribucion(g('bbbbb')).distribucion).toEqual({ tipo: 'completa', bajo: 1, moderado: 0, alto: 0 });
  });

  it('con celdas de 3 o más publica las tres categorías, redondeadas a 5 puntos', () => {
    const r = publicarDistribucion(g('bbbbbbbmmmaaa'));
    expect(r.distribucion?.tipo).toBe('completa');
    if (r.distribucion?.tipo !== 'completa') return;
    for (const v of [r.distribucion.bajo, r.distribucion.moderado, r.distribucion.alto]) expect(Math.round(v * 100) % 5).toBe(0);
    expect(r.distribucion.bajo + r.distribucion.moderado + r.distribucion.alto).toBeCloseTo(1);
  });

  it('el redondeo siempre suma 100 %', () => {
    for (const c of [[1, 1, 1], [7, 3, 3], [11, 5, 4], [2, 3, 17]]) {
      expect(redondear(c).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
  });

  it('cuenta personas, no check-ins: quien hace muchos check-ins pesa uno', () => {
    const filas = [
      ...Array.from({ length: 20 }, () => ({ userId: 'u1', nivel: 'alto' as Level })),
      { userId: 'u1', nivel: 'bajo' as Level },
      { userId: 'u2', nivel: 'moderado' as Level },
    ];
    expect(ultimoPorPersona(filas).sort()).toEqual(['bajo', 'moderado']);
  });

  it('la ventana son 4 semanas completas que terminan el lunes de la semana en curso', () => {
    const w = ventanaReporte(new Date('2026-09-30T15:00:00Z')); // miércoles
    expect(w).toEqual({ desde: '2026-08-31T00:00:00.000Z', hasta: '2026-09-28T00:00:00.000Z' });
    // Toda la semana devuelve la misma ventana: no hay cambios diarios que comparar.
    expect(ventanaReporte(new Date('2026-10-04T23:59:00Z'))).toEqual(w);
    expect(ventanaReporte(new Date('2026-09-28T00:00:00Z'))).toEqual(w);
  });
});
