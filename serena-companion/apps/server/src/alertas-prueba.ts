/**
 * Prueba real del aviso por email a quien opera SERENA, con la configuración del entorno.
 * Uso: npm run alertas:prueba -w @serena/server
 */
import { env } from './env.ts';
import { ResendAvisoOperaciones, avisoOperaciones } from './avisoOperaciones.ts';

const aviso = avisoOperaciones(env.alertas);
if (!(aviso instanceof ResendAvisoOperaciones)) {
  console.error('Faltan variables para los avisos por email: RESEND_API_KEY, SERENA_ALERTAS_FROM y SERENA_ALERTAS_EMAIL.');
  process.exit(1);
}
const ok = await aviso.enviar(
  'Prueba de avisos de operación',
  'Este es un email de prueba de SERENA. Si lo recibiste, los avisos de operación (por ejemplo, cuando Twilio rechaza los SMS) van a llegar a esta casilla.',
);
console.info(ok ? `Aviso de prueba enviado a ${env.alertas.to}.` : 'Resend no aceptó el aviso: revisá el registro de arriba.');
if (!ok) process.exit(1);
