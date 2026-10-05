import { describe, expect, it } from 'vitest';
import { applyConsents, DEFAULT_CONSENTS, type CheckIn } from '../src/index.ts';

const base: CheckIn = {
  id: 'c',
  userId: 'u',
  deviceId: 'd',
  deviceName: '',
  deviceKind: 'mobile',
  createdAt: '2026-09-01T06:00:00Z',
  updatedAt: '2026-09-01T06:00:00Z',
  rosterDay: 9,
  onShift: true,
  animo: 3,
  sueno: 1,
  escaneo: { metricas: { pulso: 78, hrv: 42, respiracion: 15, estres: 3.1 }, calidad: 0.9, duracionS: 45 },
  reaccion: { toques: 10, mediaMs: 312, anticipados: 0 },
  voz: { duracionS: 3, nivelMedio: 0.2 },
  nivel: 'moderado',
  nota: 'cansado',
};

describe('aplicación del consentimiento', () => {
  it('con todos los permisos no cambia nada', () => {
    const d = applyConsents(base, DEFAULT_CONSENTS);
    expect(d.ok && d.checkin).toEqual(base);
  });
  it('sin cámara descarta el escaneo', () => {
    const d = applyConsents(base, { ...DEFAULT_CONSENTS, camara: false });
    expect(d.ok && d.checkin.escaneo).toBeNull();
    expect(d.ok && d.quitados).toEqual(['camara']);
    expect(d.ok && d.checkin.animo).toBe(3);
  });
  it('sin ánimo descarta ánimo, sueño y la nota', () => {
    const d = applyConsents(base, { ...DEFAULT_CONSENTS, animo: false });
    expect(d.ok && [d.checkin.animo, d.checkin.sueno, d.checkin.nota]).toEqual([null, null, null]);
  });
  it('sin reacción descarta reacción y voz', () => {
    const d = applyConsents(base, { ...DEFAULT_CONSENTS, reaccion: false });
    expect(d.ok && [d.checkin.reaccion, d.checkin.voz]).toEqual([null, null]);
  });
  it('rechaza si no queda ningún dato permitido', () => {
    const d = applyConsents(base, { ...DEFAULT_CONSENTS, camara: false, animo: false, reaccion: false });
    expect(d).toEqual({ ok: false, motivo: 'sin_datos_consentidos' });
  });
  it('rechaza todo si el consentimiento fue retirado', () => {
    expect(applyConsents(base, DEFAULT_CONSENTS, false)).toEqual({ ok: false, motivo: 'consentimiento_retirado' });
  });
});
