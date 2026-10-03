import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendAvisoOperaciones, VENTANA_AVISO_MS, avisoOperaciones, type AvisoOperaciones } from '../src/avisoOperaciones.ts';
import { TwilioVerifyMessenger } from '../src/sms/verify.ts';
import { TwilioMessenger } from '../src/sms/twilio.ts';

const CFG = { apiKey: 're_prueba', from: 'SERENA <alertas@serena.test>', to: ['ops@serena.test'] };

function fetchFalso(status = 200, cuerpo: object = { id: 'email_1' }) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

/** Registra los avisos en lugar de enviarlos. */
class AvisoFalso implements AvisoOperaciones {
  avisos: Array<{ clave: string; asunto: string; texto: string }> = [];
  avisar(clave: string, asunto: string, texto: string) {
    this.avisos.push({ clave, asunto, texto });
  }
}

afterEach(() => vi.restoreAllMocks());

describe('avisos de operación por email (Resend)', () => {
  it('envía el email con la API Key, el remitente, los destinatarios y el asunto con prefijo', async () => {
    const { f, llamadas } = fetchFalso();
    expect(await new ResendAvisoOperaciones(CFG, f).enviar('Falla', 'detalle')).toBe(true);
    const { url, init } = llamadas[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_prueba');
    expect(JSON.parse(String(init.body))).toEqual({ from: CFG.from, to: CFG.to, subject: '[SERENA] Falla', text: 'detalle' });
  });

  it('avisa una sola vez por falla dentro de la ventana, y de nuevo cuando la ventana pasa', async () => {
    const { f, llamadas } = fetchFalso();
    let ahora = 0;
    const aviso = new ResendAvisoOperaciones(CFG, f, () => ahora);
    aviso.avisar('twilio:21608', 'a', 'b');
    aviso.avisar('twilio:21608', 'a', 'b');
    aviso.avisar('twilio:20003', 'a', 'b');
    await vi.waitFor(() => expect(llamadas).toHaveLength(2));
    ahora = VENTANA_AVISO_MS + 1;
    aviso.avisar('twilio:21608', 'a', 'b');
    await vi.waitFor(() => expect(llamadas).toHaveLength(3));
  });

  it('si Resend rechaza o no responde, no falla y permite reintentar con la próxima ocurrencia', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
    const { f, llamadas } = fetchFalso(403, { name: 'validation_error', message: 'domain not verified' });
    const aviso = new ResendAvisoOperaciones(CFG, f);
    aviso.avisar('twilio:21608', 'a', 'b');
    await vi.waitFor(() => expect(logs.join('\n')).toMatch(/domain not verified/));
    aviso.avisar('twilio:21608', 'a', 'b');
    await vi.waitFor(() => expect(llamadas).toHaveLength(2));

    const proxy = (async () => new Response('Forbidden', { status: 403 })) as unknown as typeof fetch;
    expect(await new ResendAvisoOperaciones(CFG, proxy).enviar('a', 'b')).toBe(false);
    expect(logs.at(-1)).toMatch(/no llegó a Resend.*api\.resend\.com/);
    expect(logs.at(-1)).not.toMatch(/Resend rechazó/);

    const caido = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await new ResendAvisoOperaciones(CFG, caido).enviar('a', 'b')).toBe(false);
  });

  it('se configura solo con API Key, remitente y al menos un destinatario', () => {
    expect(avisoOperaciones({ resendApiKey: 're', from: 'a@b.c', to: 'x@y.z, w@y.z' })).toBeInstanceOf(ResendAvisoOperaciones);
    expect(avisoOperaciones({ resendApiKey: null, from: 'a@b.c', to: 'x@y.z' })).toBeNull();
    expect(avisoOperaciones({ resendApiKey: 're', from: 'a@b.c', to: ' , ' })).toBeNull();
  });
});

describe('Twilio avisa a operaciones solo cuando falla la cuenta', () => {
  const TWILIO = { accountSid: 'AC_prueba', apiKeySid: 'SK_prueba', apiKeySecret: 'secreto', verifyServiceSid: 'VA_prueba' };

  it('21608 en Verify: un aviso con el código, el mensaje y el enlace, sin el teléfono', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const aviso = new AvisoFalso();
    const { f } = fetchFalso(403, {
      code: 21608,
      message: 'To send messages to unverified numbers like +5492645550147, you must have an approved Primary Compliance Profile.',
      more_info: 'https://www.twilio.com/docs/errors/21608',
    });
    await new TwilioVerifyMessenger({ ...TWILIO, avisoOperaciones: aviso }, f).verificador.enviar('+5492645550147', 'ingreso').catch(() => undefined);
    expect(aviso.avisos).toHaveLength(1);
    const { clave, asunto, texto } = aviso.avisos[0]!;
    expect(clave).toBe('twilio:21608');
    expect(asunto).toMatch(/21608/);
    expect(texto).toMatch(/Primary Compliance Profile/);
    expect(texto).toMatch(/https:\/\/www\.twilio\.com\/docs\/errors\/21608/);
    expect(texto).not.toMatch(/2645550147/);
  });

  it('un número inválido o una falla pasajera no avisan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const aviso = new AvisoFalso();
    for (const [status, cuerpo] of [
      [400, { code: 21211 }],
      [503, {}],
    ] as const) {
      const { f } = fetchFalso(status, cuerpo);
      await new TwilioMessenger({ ...TWILIO, from: '+15005550006', avisoOperaciones: aviso }, f)
        .sendOtp({ telefono: '+5492645550147', email: null }, '123456')
        .catch(() => undefined);
    }
    expect(aviso.avisos).toHaveLength(0);
  });
});
