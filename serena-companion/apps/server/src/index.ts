import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG } from '@serena/domain';
import { canalesDirectos, datosTransferencia, env, notificadorGuardia, problemasDeProduccion, twilioConfigurado, twilioMessenger } from './env.ts';
import { TwilioVerifyMessenger } from './sms/verify.ts';
import { avisoOperaciones, ResendAvisoOperaciones } from './avisoOperaciones.ts';
import { cerrarCanceladasVencidas, textoProforma } from './payments/ordenCompra.ts';
import { openDb } from './db.ts';
import { Vault } from './crypto.ts';
import { createApp } from './app.ts';
import { buildRegistry, loadPlans } from './payments/index.ts';
import { OrdenCompraProvider } from './payments/ordenCompra.ts';
import { BasicCompanion, ClaudeCompanion } from './companion.ts';
import { ConsoleMessenger } from './notify.ts';
import { EmisorTokensEscaneo } from './escaneoToken.ts';
import type { AppContext } from './context.ts';
import { flushOrphanGroups } from './routes/safety.ts';
import { purgarVencidas } from './baja.ts';

const here = dirname(fileURLToPath(import.meta.url));

const gd = env.guardiaDirecta;
const { smsConRemitente, emailConfigurado } = canalesDirectos();

// En producción no se arranca a medias: sin guardia ni SMS el servicio prometería algo que no cumple.
if (env.isProd) {
  const problemas = problemasDeProduccion({
    ...env,
    smsConfigurado: twilioConfigurado(env.twilio),
    guardiaDirecta: { telefonos: gd.telefonos.length, emails: gd.emails.length, smsConRemitente, emailConfigurado },
  });
  if (problemas.length) {
    console.error(`[serena] No se puede iniciar en producción:\n  - ${problemas.join('\n  - ')}`);
    process.exit(1);
  }
}

const aviso = avisoOperaciones(env.alertas);


const db = openDb(env.dbPath);
const transferencia = datosTransferencia();
const emailOrdenes = env.alertas.resendApiKey && env.alertas.from ? new ResendAvisoOperaciones({ apiKey: env.alertas.resendApiKey, from: env.alertas.from, to: [] }) : null;
const operaciones = (env.alertas.to ?? '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const planes = loadPlans();
const ctx: AppContext = {
  db,
  vault: new Vault(env.masterKey),
  jwtKey: new TextEncoder().encode(env.jwtSecret),
  publicUrl: env.publicUrl,
  exposeDevOtp: env.exposeDevOtp,
  config: process.env.SERENA_CONFIG_JSON ? { ...DEFAULT_CONFIG, ...JSON.parse(process.env.SERENA_CONFIG_JSON) } : DEFAULT_CONFIG,
  payments: buildRegistry({
    ...env.payments,
    sandboxSecret: env.jwtSecret,
    publicUrl: env.publicUrl,
    ordenCompra: transferencia
      ? {
          db,
          cfg: {
            transferencia,
            diasPago: env.payments.ordenCompra.diasPago,
            precioVigente: (planId, moneda) => planes.find((p) => p.id === planId)?.precioPorPuesto[moneda as 'ARS'],
            // La orden va al contacto de compras de la empresa y a operaciones de SERENA, con el PDF adjunto.
            notificar: async (orden, pdf, nombreOrg) => {
              if (!emailOrdenes) return console.warn(`[serena][pagos] Orden ${orden.numero} emitida sin email (falta RESEND_API_KEY o SERENA_ALERTAS_FROM).`);
              const ok = await emailOrdenes.enviarA(
                [orden.facturacion.contactoEmail, ...operaciones],
                `Orden de compra ${orden.numero} · ${orden.facturacion.razonSocial}`,
                textoProforma(orden, transferencia, nombreOrg),
                [{ nombre: `SERENA-${orden.numero}.pdf`, contenido: pdf }],
                // Las respuestas de la empresa (p. ej. con el comprobante) llegan a la casilla de cobranzas.
                transferencia.email,
              );
              if (!ok) console.error(`[serena][pagos] No se pudo enviar por email la orden ${orden.numero}.`);
            },
          },
        }
      : null,
  }),
  companion: env.anthropic.enabled ? new ClaudeCompanion(env.anthropic.model) : new BasicCompanion(),
  messenger: (env.smsReal ? twilioMessenger(env.twilio, aviso) : null) ?? new ConsoleMessenger(),
  guard: notificadorGuardia(aviso),
  escaneoTokens: env.escaneo.adminKey
    ? new EmisorTokensEscaneo({
        adminKey: env.escaneo.adminKey,
        ttlS: env.escaneo.tokenTtlS,
        maxMediciones: env.escaneo.tokenMaxMediciones,
        licenseId: env.escaneo.licenseId,
        aviso,
      })
    : null,
};

flushOrphanGroups(ctx);
// Al iniciar y cada hora: cuentas dadas de baja cuyo período de gracia venció, y suscripciones por orden de compra
// canceladas cuyo período pagado terminó.
const purgar = () => {
  const n = purgarVencidas(ctx);
  if (n) console.info(`[serena] ${n} cuenta(s) dada(s) de baja eliminada(s) al vencer el período de gracia`);
  const c = cerrarCanceladasVencidas(ctx.db);
  if (c) console.info(`[serena][pagos] ${c} suscripción(es) por orden de compra cancelada(s) al terminar el período pagado`);
  // Órdenes del período siguiente del plan Empresa, con `diasPago` días de anticipación.
  const oc = ctx.payments.get('orden_compra');
  if (oc instanceof OrdenCompraProvider) {
    try {
      oc.emitirRenovaciones();
    } catch (e) {
      console.error('[serena][pagos][ALERTA] No se pudieron emitir las renovaciones:', e);
    }
  }
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
  const guardia = [env.guardWebhookUrl && 'webhook', gd.telefonos.length && `SMS a ${gd.telefonos.length} teléfono(s)`, gd.emails.length && `email a ${gd.emails.length} dirección(es)`].filter(Boolean);
  console.info(`[serena] Guardia: ${guardia.join(' + ') || 'consola (desarrollo)'}`);
  console.info(`[serena] Alertas de operación: ${aviso ? `email a ${env.alertas.to}` : 'solo en los registros (sin RESEND_API_KEY, SERENA_ALERTAS_FROM o SERENA_ALERTAS_EMAIL)'}`);
  console.info(`[serena] Escaneo: ${ctx.escaneoTokens ? 'tokens de corta duración emitidos por el servidor' : 'sin credencial de administración (SHENAI_ADMIN_KEY)'}`);
  console.info(`[serena] Pagos: ${ctx.payments.list().map((p) => p.nombre).join(', ') || 'ninguno configurado'}`);
});
