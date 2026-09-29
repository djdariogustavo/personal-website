/**
 * Prueba real de SMS con la configuración de Twilio del entorno.
 * Uso: npm run sms:prueba -w @serena/server -- +5492645550147 [código]
 * - Con TWILIO_VERIFY_SERVICE_SID: envía un código de Twilio Verify; con el segundo argumento, lo valida.
 * - Sin él: envía un código generado aquí por Programmable Messaging (número o Messaging Service).
 */
import { env, twilioMessenger } from '../env.ts';
import { aE164 } from './twilio.ts';

const destino = process.argv[2] ? aE164(process.argv[2]) : null;
const codigo = process.argv[3];
if (!destino || (codigo !== undefined && !/^\d{4,10}$/.test(codigo))) {
  console.error('Indicá el número en formato internacional y, para validar, el código recibido: npm run sms:prueba -w @serena/server -- +5492645550147 [123456]');
  process.exit(1);
}
const messenger = twilioMessenger(env.twilio);
if (!messenger) {
  console.error('Faltan variables de Twilio: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET y TWILIO_VERIFY_SERVICE_SID (o TWILIO_FROM_NUMBER o TWILIO_MESSAGING_SERVICE_SID).');
  process.exit(1);
}
const fin = `…${destino.slice(-2)}`;
try {
  if (messenger.verificador && codigo) {
    const ok = await messenger.verificador.comprobar(destino, codigo);
    console.info(ok ? `Código aprobado por Twilio Verify para ${fin}.` : `Twilio Verify no aprobó el código (no coincide, venció o ya se usó).`);
    if (!ok) process.exit(1);
  } else if (messenger.verificador) {
    await messenger.verificador.enviar(destino, 'ingreso');
    console.info(`Código de Twilio Verify enviado a ${fin}. Para validarlo: npm run sms:prueba -w @serena/server -- ${process.argv[2]} <código>`);
  } else {
    await messenger.sendOtp({ telefono: destino, email: null }, String(Math.floor(100000 + Math.random() * 900000)));
    console.info(`SMS de prueba enviado a ${fin}. Revisá el teléfono.`);
  }
} catch (e) {
  console.error(`No se pudo completar la prueba: ${(e as Error).message}`);
  process.exit(1);
}
