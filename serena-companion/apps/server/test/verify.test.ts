import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { TwilioVerifyMessenger } from '../src/sms/verify.ts';
import { SmsNoEnviado, detalleParaRegistro, motivoDeRechazo } from '../src/sms/twilio.ts';
import { twilioConfigurado, twilioMessenger } from '../src/env.ts';
import type { Messenger, OtpProposito } from '../src/notify.ts';
import { addUser, device, makeCtx } from './helpers.ts';

const CFG = { accountSid: 'AC_prueba', apiKeySid: 'SK_prueba', apiKeySecret: 'secreto-de-prueba', verifyServiceSid: 'VA_prueba' };

function fetchFalso(respuestas: Array<[number, object]>) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    const [status, cuerpo] = respuestas.shift() ?? [200, {}];
    return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

/** Verify simulado: "envía" un código fijo por teléfono y lo aprueba una sola vez, como Twilio. */
class VerifyFalso implements Messenger {
  enviados: Array<{ telefono: string | null; proposito: OtpProposito }> = [];
  checks = 0;
  avisos: string[] = [];
  private pendientes = new Map<string, string>();
  readonly verificador = {
    enviar: async (telefono: string | null, proposito: OtpProposito) => {
      this.enviados.push({ telefono, proposito });
      this.pendientes.set(telefono ?? '', '135790');
    },
    comprobar: async (telefono: string | null, codigo: string) => {
      this.checks++;
      if (this.pendientes.get(telefono ?? '') !== codigo) return false;
      this.pendientes.delete(telefono ?? '');
      return true;
    },
  };
  async sendOtp(): Promise<void> {
    throw new Error('no se usa con Verify');
  }
  async sendAviso(_to: unknown, texto: string) {
    this.avisos.push(texto);
  }
}

function ctxConVerify() {
  const base = makeCtx();
  const verify = new VerifyFalso();
  base.ctx.messenger = verify;
  return { ...base, verify };
}

afterEach(() => vi.restoreAllMocks());

describe('Twilio Verify: cliente', () => {
  it('envía la verificación al servicio con la API Key, el destino en E.164 y el canal SMS', async () => {
    const { f, llamadas } = fetchFalso([[201, { sid: 'VE1', status: 'pending' }]]);
    await new TwilioVerifyMessenger(CFG, f).verificador.enviar('+54 9 264 555-0147', 'ingreso');
    const { url, init } = llamadas[0]!;
    expect(url).toBe('https://verify.twilio.com/v2/Services/VA_prueba/Verifications');
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('SK_prueba:secreto-de-prueba')}`);
    const body = new URLSearchParams(String(init.body));
    expect(body.get('To')).toBe('+5492645550147');
    expect(body.get('Channel')).toBe('sms');
  });

  it('aprueba solo con status "approved"; 404 y 60202 son "código no válido", no una falla', async () => {
    const { f, llamadas } = fetchFalso([
      [200, { status: 'approved' }],
      [200, { status: 'pending' }],
      [404, { code: 20404 }],
      [429, { code: 60202 }],
    ]);
    const v = new TwilioVerifyMessenger(CFG, f).verificador;
    expect(await v.comprobar('+5492645550147', '123456')).toBe(true);
    expect(await v.comprobar('+5492645550147', '123456')).toBe(false);
    expect(await v.comprobar('+5492645550147', '123456')).toBe(false);
    expect(await v.comprobar('+5492645550147', '123456')).toBe(false);
    expect(llamadas[0]!.url).toBe('https://verify.twilio.com/v2/Services/VA_prueba/VerificationCheck');
    expect(new URLSearchParams(String(llamadas[0]!.init.body)).get('Code')).toBe('123456');
  });

  it('si Twilio rechaza el envío, falla con SmsNoEnviado sin escribir el teléfono en los registros', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
    const { f } = fetchFalso([[400, { code: 60410, message: 'blocked +5492645550147' }]]);
    await expect(new TwilioVerifyMessenger(CFG, f).verificador.enviar('+5492645550147', 'ingreso')).rejects.toBeInstanceOf(SmsNoEnviado);
    expect(logs.join('\n')).toMatch(/60410/);
    expect(logs.join('\n')).not.toMatch(/2645550147/);
  });

  it('un rechazo de la cuenta (21608) registra código, mensaje y enlace de Twilio con la marca [ALERTA]', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
    const { f } = fetchFalso([
      [
        403,
        {
          code: 21608,
          message: 'To send messages or make calls to unverified numbers, you must have an approved Primary Compliance Profile. Go to https://1console.twilio.com/account/ACprueba12345678901234/us1/trusthub/compliance-profiles/primary to create your profile.',
          more_info: 'https://www.twilio.com/docs/errors/21608',
        },
      ],
    ]);
    const e = await new TwilioVerifyMessenger(CFG, f).verificador.enviar('+5492645550147', 'ingreso').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SmsNoEnviado);
    expect((e as SmsNoEnviado).motivo).toBe('cuenta');
    const registro = logs.join('\n');
    expect(registro).toMatch(/\[ALERTA\]/);
    expect(registro).toMatch(/Primary Compliance Profile/);
    expect(registro).toMatch(/https:\/\/www\.twilio\.com\/docs\/errors\/21608/);
    expect(registro).toMatch(/ACprueba12345678901234/);
    expect(registro).not.toMatch(/2645550147/);
  });

  it('el detalle para los registros oculta los teléfonos del mensaje de Twilio en cualquier formato', () => {
    for (const tel of ['+5492645550147', '+54 9 264 555-0147', '2645550147', '(264) 555-0147'])
      expect(detalleParaRegistro({ code: 21211, message: `The 'To' number ${tel} is not valid` })).toBe("código 21211: The 'To' number [número] is not valid");
    expect(detalleParaRegistro({})).toBe('código —: —');
  });

  it('clasifica los rechazos: cuenta, destino o temporal', () => {
    expect(motivoDeRechazo(403, 21608)).toBe('cuenta');
    expect(motivoDeRechazo(401, 20003)).toBe('cuenta');
    expect(motivoDeRechazo(401, null)).toBe('cuenta');
    expect(motivoDeRechazo(404, 20404)).toBe('cuenta');
    expect(motivoDeRechazo(400, 21211)).toBe('destino');
    expect(motivoDeRechazo(400, 60410)).toBe('destino');
    expect(motivoDeRechazo(429, 20429)).toBe('temporal');
    expect(motivoDeRechazo(503, null)).toBe('temporal');
  });

  it('una falla del servicio al validar no se confunde con un código incorrecto', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { f } = fetchFalso([[503, { code: 20500 }]]);
    await expect(new TwilioVerifyMessenger(CFG, f).verificador.comprobar('+5492645550147', '123456')).rejects.toBeInstanceOf(SmsNoEnviado);
  });

  it('los avisos sin código salen por el remitente propio si existe; si no, no se envían y no fallan', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sin = fetchFalso([]);
    await new TwilioVerifyMessenger(CFG, sin.f).sendAviso({ telefono: '+5492645550147', email: null }, 'aviso');
    expect(sin.llamadas).toHaveLength(0);
    const con = fetchFalso([[201, { sid: 'SM1' }]]);
    await new TwilioVerifyMessenger({ ...CFG, messagingServiceSid: 'MG_prueba' }, con.f).sendAviso({ telefono: '+5492645550147', email: null }, 'aviso');
    expect(con.llamadas[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC_prueba/Messages.json');
  });
});

describe('Twilio Verify: configuración', () => {
  const t = { accountSid: 'AC', apiKeySid: 'SK', apiKeySecret: 's', from: null, messagingServiceSid: null, verifyServiceSid: 'VA' };
  it('alcanza con el servicio de Verify, sin número propio, y tiene prioridad', () => {
    expect(twilioConfigurado(t)).toBe(true);
    expect(twilioMessenger(t)).toBeInstanceOf(TwilioVerifyMessenger);
    expect(twilioMessenger({ ...t, from: '+15005550006' })).toBeInstanceOf(TwilioVerifyMessenger);
  });
  it('sin API Key no hay mensajero', () => {
    expect(twilioMessenger({ ...t, apiKeySecret: null })).toBeNull();
  });
});

describe('ingreso con Twilio Verify', () => {
  it('Twilio envía el código y lo valida; SERENA no lo conoce ni lo devuelve', async () => {
    const { ctx, app, orgId, verify } = ctxConVerify();
    ctx.exposeDevOtp = true;
    addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'p' });
    const r1 = await request(app).post('/api/auth/login').send({ identificador: '30111222', password: 'p', device: device() });
    expect(r1.body.paso).toBe('segundo_factor');
    expect(r1.body.codigoDesarrollo).toBeUndefined();
    expect(verify.enviados).toEqual([{ telefono: '+5400000047', proposito: 'ingreso' }]);

    const mal = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: '000000', device: device() });
    expect(mal.body.error).toBe('codigo_incorrecto');
    const bien = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: '135790', device: device() });
    expect(bien.body.token).toBeTruthy();
  });

  it('cuenta los intentos fallidos en SERENA: al quinto, el desafío vence', async () => {
    const { ctx, app, orgId } = ctxConVerify();
    addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'p' });
    const r1 = await request(app).post('/api/auth/login').send({ identificador: '30111222', password: 'p', device: device() });
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: '000000', device: device() });
    const r = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: '135790', device: device() });
    expect(r.body.error).toBe('codigo_vencido');
  });

  it('si Verify no responde al validar, informa 502 y no suma un intento fallido', async () => {
    const { ctx, app, orgId, verify } = ctxConVerify();
    addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'p' });
    const r1 = await request(app).post('/api/auth/login').send({ identificador: '30111222', password: 'p', device: device() });
    verify.verificador.comprobar = async () => {
      throw new SmsNoEnviado('caído');
    };
    const r = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: '135790', device: device() });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe('verificacion_no_disponible');
    const { intentos } = ctx.db.prepare('SELECT intentos FROM login_challenges WHERE id = ?').get(r1.body.challengeId) as { intentos: number };
    expect(intentos).toBe(0);
  });
});

describe('ingreso cuando el SMS no sale, según el motivo', () => {
  const casos = [
    ['cuenta', 503, 'sms_no_disponible', /no está disponible/],
    ['destino', 502, 'sms_telefono_invalido', /revise tu número/],
    ['temporal', 502, 'sms_no_enviado', /Probá de nuevo/],
  ] as const;
  for (const [motivo, status, error, mensaje] of casos)
    it(`${motivo}: HTTP ${status} y ${error}`, async () => {
      const { ctx, app, orgId, verify } = ctxConVerify();
      addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'p' });
      verify.verificador.enviar = async () => {
        throw new SmsNoEnviado('rechazado', null, motivo);
      };
      const r = await request(app).post('/api/auth/login').send({ identificador: '30111222', password: 'p', device: device() });
      expect(r.status).toBe(status);
      expect(r.body.error).toBe(error);
      expect(r.body.mensaje).toMatch(mensaje);
    });

  it('si la cuenta de Twilio no permite validar, no invita a reintentar', async () => {
    const { ctx, app, orgId, verify } = ctxConVerify();
    addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'p' });
    const r1 = await request(app).post('/api/auth/login').send({ identificador: '30111222', password: 'p', device: device() });
    verify.verificador.comprobar = async () => {
      throw new SmsNoEnviado('rechazado', 20003, 'cuenta');
    };
    const r = await request(app).post('/api/auth/verify').send({ challengeId: r1.body.challengeId, codigo: '135790', device: device() });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('verificacion_no_disponible');
    expect(r.body.mensaje).not.toMatch(/Probá de nuevo/);
  });
});

describe('recuperación de contraseña con Twilio Verify', () => {
  it('con una contraseña que no cumple, el mismo código sigue sirviendo aunque Twilio ya lo haya consumido', async () => {
    const { ctx, app, orgId, verify } = ctxConVerify();
    addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'vieja' });
    const s = await request(app).post('/api/auth/recover/start').send({ identificador: '30111222' });
    await vi.waitFor(() => expect(verify.enviados).toEqual([{ telefono: '+5400000047', proposito: 'recuperacion' }]));

    const debil = await request(app).post('/api/auth/recover/finish').send({ challengeId: s.body.challengeId, codigo: '135790', nueva: '123' });
    expect(debil.body.error).toBe('password_debil');
    const ok = await request(app)
      .post('/api/auth/recover/finish')
      .send({ challengeId: s.body.challengeId, codigo: '135790', nueva: 'Montaña-Serena-2026!' });
    expect(ok.body.ok).toBe(true);
    expect(verify.checks).toBe(1);
  });

  it('para una cuenta inexistente no llama a Twilio y responde igual que un código incorrecto', async () => {
    const { app, verify } = ctxConVerify();
    const s = await request(app).post('/api/auth/recover/start').send({ identificador: '99888777' });
    expect(s.body.challengeId).toBeTruthy();
    const r = await request(app).post('/api/auth/recover/finish').send({ challengeId: s.body.challengeId, codigo: '135790', nueva: 'Montaña-Serena-2026!' });
    expect(r.body.error).toBe('codigo_incorrecto');
    expect(verify.enviados).toHaveLength(0);
    expect(verify.checks).toBe(0);
  });
});
