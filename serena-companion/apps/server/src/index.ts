import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG } from '@serena/domain';
import { env, problemasDeProduccion, twilioConfigurado, twilioMessenger } from './env.ts';
import { TwilioVerifyMessenger } from './sms/verify.ts';
import { avisoOperaciones } from './avisoOperaciones.ts';
import { openDb } from './db.ts';
import { Vault } from './crypto.ts';
import { createApp } from './app.ts';
import { buildRegistry } from './payments/index.ts';
import { BasicCompanion, ClaudeCompanion } from './companion.ts';
import { ConsoleGuardNotifier, ConsoleMessenger, WebhookGuardNotifier } from './notify.ts';
import type { AppContext } from './context.ts';
import { flushOrphanGroups } from './routes/safety.ts';
import { purgarVencidas } from './baja.ts';

const here = dirname(fileURLToPath(import.meta.url));

// En producción no se arranca a medias: sin guardia ni SMS el servicio prometería algo que no cumple.
if (env.isProd) {
  const problemas = problemasDeProduccion({ ...env, smsConfigurado: twilioConfigurado(env.twilio) });
  if (problemas.length) {
    console.error(`[serena] No se puede iniciar en producción:\n  - ${problemas.join('\n  - ')}`);
    process.exit(1);
  }
}

const aviso = avisoOperaciones(env.alertas);

const ctx: AppContext = {
  db: openDb(env.dbPath),
  vault: new Vault(env.masterKey),
  jwtKey: new TextEncoder().encode(env.jwtSecret),
  publicUrl: env.publicUrl,
  exposeDevOtp: env.exposeDevOtp,
  config: process.env.SERENA_CONFIG_JSON ? { ...DEFAULT_CONFIG, ...JSON.parse(process.env.SERENA_CONFIG_JSON) } : DEFAULT_CONFIG,
  payments: buildRegistry({ ...env.payments, sandboxSecret: env.jwtSecret, publicUrl: env.publicUrl }),
  companion: env.anthropic.enabled ? new ClaudeCompanion(env.anthropic.model) : new BasicCompanion(),
  messenger: (env.smsReal ? twilioMessenger(env.twilio, aviso) : null) ?? new ConsoleMessenger(),
  guard: env.guardWebhookUrl ? new WebhookGuardNotifier(env.guardWebhookUrl, env.guardWebhookSecret) : new ConsoleGuardNotifier(),
};

flushOrphanGroups(ctx);
// Cuentas dadas de baja cuyo período de gracia venció: al iniciar y cada hora.
const purgar = () => {
  const n = purgarVencidas(ctx);
  if (n) console.info(`[serena] ${n} cuenta(s) dada(s) de baja eliminada(s) al vencer el período de gracia`);
};
purgar();
setInterval(purgar, 3_600_000).unref();
const app = createApp(ctx, {
  staticDir: process.env.SERENA_STATIC_DIR ?? join(here, '../../web/dist'),
  aislamientoOrigen: env.escaneo.aislamientoOrigen,
  escaneoConnectSrc: env.escaneo.connectSrc,
});
app.listen(env.port, () => {
  console.info(`[serena] API en http://localhost:${env.port}`);
  console.info(`[serena] Acompañante: ${env.anthropic.enabled ? `modelo ${env.anthropic.model}` : 'básico (sin ANTHROPIC_API_KEY)'}`);
  const sms = ctx.messenger instanceof TwilioVerifyMessenger ? 'Twilio Verify' : ctx.messenger instanceof ConsoleMessenger ? 'consola (desarrollo)' : 'Twilio';
  console.info(`[serena] SMS: ${sms}`);
  console.info(`[serena] Alertas de operación: ${aviso ? `email a ${env.alertas.to}` : 'solo en los registros (sin RESEND_API_KEY, SERENA_ALERTAS_FROM o SERENA_ALERTAS_EMAIL)'}`);
  console.info(`[serena] Pagos: ${ctx.payments.list().map((p) => p.nombre).join(', ') || 'ninguno configurado'}`);
});
