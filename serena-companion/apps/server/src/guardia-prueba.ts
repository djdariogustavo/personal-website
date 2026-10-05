/**
 * Prueba real del canal hacia la guardia con la configuración del entorno: envía un aviso FICTICIO, marcado
 * como prueba, a los destinos configurados (webhook, SERENA_GUARDIA_TELEFONOS, SERENA_GUARDIA_EMAILS).
 * Uso: npm run guardia:prueba -w @serena/server
 */
import { env, notificadorGuardia } from './env.ts';
import { avisoOperaciones } from './avisoOperaciones.ts';
import { ConsoleGuardNotifier } from './notify.ts';

const guardia = notificadorGuardia(avisoOperaciones(env.alertas));
if (guardia instanceof ConsoleGuardNotifier) {
  console.error('No hay canal hacia la guardia: definí SERENA_GUARDIA_TELEFONOS y/o SERENA_GUARDIA_EMAILS (o SERENA_GUARD_WEBHOOK_URL).');
  process.exit(1);
}
const r = await guardia.notify({
  alertId: `prueba-${Date.now()}`,
  orgId: 'prueba',
  faena: 'PRUEBA DEL CANAL (ignorar)',
  tipo: 'hablar',
  prioridad: 'normal',
  origen: 'boton',
  trabajador: { id: 'prueba', nombre: 'PERSONA DE PRUEBA', legajo: '0000', telefono: null },
  ubicacion: null,
  creadoEn: new Date().toISOString(),
});
console.info(r.entregado ? 'Aviso de prueba aceptado por al menos un canal. Revisá los teléfonos y las casillas de la guardia.' : 'Ningún canal aceptó el aviso: revisá el registro de arriba.');
if (!r.entregado) process.exit(1);
