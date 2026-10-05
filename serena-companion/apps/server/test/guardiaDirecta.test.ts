import { describe, expect, it, vi } from 'vitest';
import { GuardiaDirectaNotifier, GuardiasCombinadas, textoEmailGuardia, textoSmsGuardia } from '../src/guardiaDirecta.ts';
import { problemasDeProduccion } from '../src/env.ts';
import type { GuardAlert, Messenger } from '../src/notify.ts';

const ALERTA: GuardAlert = {
  alertId: 'al-1',
  orgId: 'o',
  faena: 'Mina Piloto',
  tipo: 'resultado_alto',
  prioridad: 'alta',
  origen: 'resultado_alto',
  trabajador: { id: 'u', nombre: 'Ana Pérez', legajo: '0042', telefono: '+5493510000000' },
  ubicacion: { lat: -31.4201, lng: -64.1888, precisionM: 12.4 },
  creadoEn: '2026-10-04T15:30:00.000Z',
};
const CFG = { telefonos: ['+5493511111111', '+5493512222222'], emails: ['guardia@empresa.com'], zonaHoraria: 'America/Argentina/Buenos_Aires' };

function sms(falla = new Set<string>()) {
  const enviados: string[] = [];
  const m: Messenger = {
    sendOtp: async () => undefined,
    sendAviso: async (to) => {
      if (falla.has(to.telefono!)) throw new Error('rechazado');
      enviados.push(to.telefono!);
    },
  };
  return { m, enviados };
}

describe('aviso directo a la guardia', () => {
  it('el SMS dice qué pasa, quién, cómo contactarla, dónde está y la hora local', () => {
    const t = textoSmsGuardia(ALERTA, CFG.zonaHoraria);
    expect(t).toContain('[ALTA]');
    expect(t).toContain('Ana Pérez (leg. 0042), tel +5493510000000');
    expect(t).toContain('https://maps.google.com/?q=-31.42010,-64.18880 (±12 m)');
    expect(t).toContain('Mina Piloto, 12:30 h');
    expect(textoSmsGuardia({ ...ALERTA, ubicacion: null, prioridad: 'normal', tipo: 'hablar' }, CFG.zonaHoraria)).toMatch(/^SERENA GUARDIA: Necesita hablar.*Sin ubicacion/);
    expect(textoEmailGuardia(ALERTA, CFG.zonaHoraria).asunto).toBe('ALTA · Resultado alto en el check-in · Ana Pérez · Mina Piloto');
  });

  it('envía a todos los teléfonos y al email; entregado si al menos uno aceptó', async () => {
    const { m, enviados } = sms(new Set(['+5493511111111']));
    const email = { enviar: vi.fn(async () => false) };
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await new GuardiaDirectaNotifier(CFG, m, email).notify(ALERTA)).toEqual({ entregado: true });
    expect(enviados).toEqual(['+5493512222222']);
    expect(email.enviar).toHaveBeenCalledOnce();
    // Los registros no llevan el nombre ni el teléfono de la persona.
    expect(err.mock.calls.flat().join(' ')).not.toMatch(/Ana|0000000/);
    err.mockRestore();
  });

  it('si ningún envío sale, no informa "entregado" (la app sugiere la radio)', async () => {
    const { m } = sms(new Set(CFG.telefonos));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await new GuardiaDirectaNotifier(CFG, m, { enviar: async () => false }).notify(ALERTA)).toEqual({ entregado: false });
    expect(await new GuardiaDirectaNotifier(CFG, null, null).notify(ALERTA)).toEqual({ entregado: false });
  });

  it('webhook y aviso directo juntos: entregado si alguno lo entregó', async () => {
    const no = { canal: 'x', notify: async () => ({ entregado: false }) };
    const si = { canal: 'x', notify: async () => ({ entregado: true }) };
    expect(await new GuardiasCombinadas([no, si]).notify(ALERTA)).toEqual({ entregado: true });
    expect(await new GuardiasCombinadas([no, no]).notify(ALERTA)).toEqual({ entregado: false });
  });

  it('en producción alcanza con el aviso directo, si cada canal tiene su proveedor', () => {
    const base = { guardWebhookUrl: null, guardWebhookSecret: null, smsConfigurado: true };
    expect(problemasDeProduccion({ ...base, guardiaDirecta: { telefonos: 2, emails: 1, smsConRemitente: true, emailConfigurado: true } })).toEqual([]);
    const p = problemasDeProduccion({ ...base, guardiaDirecta: { telefonos: 1, emails: 1, smsConRemitente: false, emailConfigurado: false } });
    expect(p.join(' ')).toMatch(/TWILIO_MESSAGING_SERVICE_SID/);
    expect(p.join(' ')).toMatch(/RESEND_API_KEY/);
  });
});
