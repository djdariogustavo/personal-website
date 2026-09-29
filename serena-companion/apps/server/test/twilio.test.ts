import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { TEXTOS, TwilioMessenger, SmsNoEnviado, aE164, aGsm7, esGsm7 } from '../src/sms/twilio.ts';
import { AVISO } from '../src/routes/password.ts';
import { addUser, makeCtx } from './helpers.ts';

const CFG = { accountSid: 'AC_prueba', apiKeySid: 'SK_prueba', apiKeySecret: 'secreto-de-prueba', from: '+15005550006' };

function fetchFalso(status = 201, cuerpo: object = { sid: 'SM1' }) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

afterEach(() => vi.restoreAllMocks());

describe('Twilio: envío de SMS', () => {
  it('llama a la API de mensajes con la API Key, el destino en E.164 y el texto del código', async () => {
    const { f, llamadas } = fetchFalso();
    await new TwilioMessenger(CFG, f).sendOtp({ telefono: '+54 9 264 555-0147', email: null }, '482913');
    expect(llamadas).toHaveLength(1);
    const { url, init } = llamadas[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC_prueba/Messages.json');
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('SK_prueba:secreto-de-prueba')}`);
    const body = new URLSearchParams(String(init.body));
    expect(body.get('To')).toBe('+5492645550147');
    expect(body.get('From')).toBe('+15005550006');
    expect(body.get('Body')).toContain('482913');
  });

  it('usa el Messaging Service si está configurado', async () => {
    const { f, llamadas } = fetchFalso();
    await new TwilioMessenger({ ...CFG, from: null, messagingServiceSid: 'MG_prueba' }, f).sendAviso({ telefono: '+5492645550147', email: null }, 'hola');
    const body = new URLSearchParams(String(llamadas[0]!.init.body));
    expect(body.get('MessagingServiceSid')).toBe('MG_prueba');
    expect(body.get('From')).toBeNull();
  });

  it('si Twilio rechaza, falla con SmsNoEnviado y no escribe el código ni el teléfono en los registros', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
    const { f } = fetchFalso(400, { code: 21211, message: "The 'To' number +5492645550147 is not a valid phone number." });
    await expect(new TwilioMessenger(CFG, f).sendOtp({ telefono: '+5492645550147', email: null }, '482913')).rejects.toBeInstanceOf(SmsNoEnviado);
    expect(logs.join('\n')).toMatch(/21211/);
    expect(logs.join('\n')).not.toMatch(/482913|2645550147/);
  });

  it('sin teléfono válido no llama a Twilio', async () => {
    const { f, llamadas } = fetchFalso();
    await expect(new TwilioMessenger(CFG, f).sendOtp({ telefono: '264 555 0147', email: null }, '1')).rejects.toBeInstanceOf(SmsNoEnviado);
    await expect(new TwilioMessenger(CFG, f).sendOtp({ telefono: null, email: 'a@b.c' }, '1')).rejects.toBeInstanceOf(SmsNoEnviado);
    expect(llamadas).toHaveLength(0);
  });

  it('normaliza teléfonos a E.164 y no adivina el país', () => {
    expect(aE164('+54 9 (264) 555-0147')).toBe('+5492645550147');
    expect(aE164('2645550147')).toBeNull();
    expect(aE164('+0 123')).toBeNull();
  });
});

describe('Twilio: costo de cada SMS', () => {
  const todos = [TEXTOS.ingreso('482913'), TEXTOS.recuperacion('482913'), ...Object.values(AVISO)].map(aGsm7);
  it('todos los textos quedan en alfabeto GSM-7 (sin tildes que obliguen a UCS-2)', () => {
    for (const t of todos) expect(esGsm7(t), t).toBe(true);
  });
  it('y entran en un solo segmento de 160 caracteres', () => {
    for (const t of todos) expect([...t].length, t).toBeLessThanOrEqual(160);
  });
  it('la conversión conserva ñ, é, ¿ y ¡', () => {
    expect(aGsm7('¿Contraseña? ¡Sí, está bien!')).toBe('¿Contraseña? ¡Si, esta bien!');
  });
});

describe('ingreso cuando el SMS no sale', () => {
  it('responde 502 con un mensaje claro, no un error 500', async () => {
    const { ctx, app, orgId } = makeCtx();
    addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'p' });
    ctx.messenger.sendOtp = async () => {
      throw new SmsNoEnviado('rechazado', 21610);
    };
    const r = await request(app)
      .post('/api/auth/login')
      .send({ identificador: '30111222', password: 'p', device: { kind: 'mobile', nombre: 'Tel', sistema: 'Test' } });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe('sms_no_enviado');
  });
});
