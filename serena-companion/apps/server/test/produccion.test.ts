import { afterEach, describe, expect, it, vi } from 'vitest';
import { problemasDeProduccion } from '../src/env.ts';
import { ConsoleGuardNotifier, ConsoleMessenger, type GuardAlert } from '../src/notify.ts';

const ALERTA: GuardAlert = {
  alertId: 'a1',
  orgId: 'o',
  faena: 'Mina',
  tipo: 'riesgo',
  prioridad: 'alta',
  origen: 'boton',
  trabajador: { id: 'u', nombre: 'Nombre Secreto', legajo: '1', telefono: '+54 9 11 0000-0000' },
  ubicacion: null,
  creadoEn: new Date().toISOString(),
};

describe('configuración de producción', () => {
  it('sin canal de guardia ni SMS, el servidor no puede operar', () => {
    const p = problemasDeProduccion({ guardWebhookUrl: null, guardWebhookSecret: null, smsConfigurado: false });
    expect(p.join(' ')).toMatch(/SERENA_GUARD_WEBHOOK_URL/);
    expect(p.join(' ')).toMatch(/SMS/);
  });
  it('el aviso a la guardia exige https y firma', () => {
    expect(problemasDeProduccion({ guardWebhookUrl: 'http://guardia.local', guardWebhookSecret: null, smsConfigurado: true })).toHaveLength(2);
    expect(problemasDeProduccion({ guardWebhookUrl: 'https://guardia.minera.com/serena', guardWebhookSecret: 's3cr3t', smsConfigurado: true })).toEqual([]);
  });
});

describe('simuladores en producción', () => {
  const env0 = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env0;
    vi.restoreAllMocks();
  });

  it('el simulador de guardia nunca informa "entregado" ni escribe el nombre en los registros', async () => {
    process.env.NODE_ENV = 'production';
    const logs: string[] = [];
    for (const k of ['info', 'warn', 'error', 'log'] as const) vi.spyOn(console, k).mockImplementation((...a) => void logs.push(a.join(' ')));
    const r = await new ConsoleGuardNotifier().notify(ALERTA);
    expect(r.entregado).toBe(false);
    expect(logs.join('\n')).not.toMatch(/Nombre Secreto|0000-0000/);
  });

  it('el mensajero de consola no escribe códigos ni teléfonos en los registros', async () => {
    process.env.NODE_ENV = 'production';
    const logs: string[] = [];
    for (const k of ['info', 'warn', 'error', 'log'] as const) vi.spyOn(console, k).mockImplementation((...a) => void logs.push(a.join(' ')));
    await new ConsoleMessenger().sendOtp({ telefono: '+54 9 11 5555-1234', email: null }, '482913');
    await new ConsoleMessenger().sendAviso({ telefono: '+54 9 11 5555-1234', email: null }, 'aviso');
    expect(logs.join('\n')).not.toMatch(/482913|5555-1234/);
  });

  it('en desarrollo el simulador sigue funcionando para demos', async () => {
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await new ConsoleGuardNotifier().notify(ALERTA)).entregado).toBe(true);
  });
});
