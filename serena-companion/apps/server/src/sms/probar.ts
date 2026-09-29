/**
 * Envía un SMS de prueba real con la configuración de Twilio del entorno.
 * Uso: npm run sms:prueba -w @serena/server -- +5492645550147
 * (en una cuenta de prueba, el destino tiene que ser un número verificado en la consola).
 */
import { env, twilioConfigurado } from '../env.ts';
import { TwilioMessenger, aE164 } from './twilio.ts';

const destino = process.argv[2] ? aE164(process.argv[2]) : null;
if (!destino) {
  console.error('Indicá el número en formato internacional, p. ej.: npm run sms:prueba -w @serena/server -- +5492645550147');
  process.exit(1);
}
if (!twilioConfigurado(env.twilio)) {
  console.error('Faltan variables de Twilio: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET y TWILIO_FROM_NUMBER (o TWILIO_MESSAGING_SERVICE_SID).');
  process.exit(1);
}
const t = env.twilio;
await new TwilioMessenger({ accountSid: t.accountSid!, apiKeySid: t.apiKeySid!, apiKeySecret: t.apiKeySecret!, from: t.from, messagingServiceSid: t.messagingServiceSid })
  .sendOtp({ telefono: destino, email: null }, String(Math.floor(100000 + Math.random() * 900000)))
  .then(() => console.info(`SMS de prueba enviado a …${destino.slice(-2)}. Revisá el teléfono.`))
  .catch((e: Error) => {
    console.error(`No se pudo enviar: ${e.message}`);
    process.exit(1);
  });
