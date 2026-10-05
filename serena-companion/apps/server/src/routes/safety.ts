import { Router } from 'express';
import { z } from 'zod';
import type { EmergencyAck } from '@serena/domain';
import type { AppContext } from '../context.ts';
import { HttpError, auth } from '../auth.ts';
import { newId } from '../crypto.ts';
import { nowIso } from '../db.ts';
import { getConsents, getOrg, getUser } from '../users.ts';
import { guardAlertPriority, guardAlertType, type EmergencyOrigin } from '../notify.ts';
import { decideAlert, masGrave, RESUMEN_CADA_MS, VENTANA_MS } from '../alertThrottle.ts';
import { rateLimit } from '../ratelimit.ts';

/**
 * Botón de emergencia (6.13) y escalamiento a la guardia (resultado alto 6.9,
 * estado de cuidado 6.10). Reglas:
 * - Siempre disponible: no depende del consentimiento ni del estado del pago.
 * - Solo la guardia recibe el aviso, nunca el supervisor.
 * - Idempotente por id (el cliente reintenta cada 10 s si no hay señal).
 * - Cada escalamiento queda en el registro de auditoría y cuenta como
 *   "información compartida" en Privacidad.
 */
export function safetyRoutes(ctx: AppContext) {
  const r = Router();
  const { db, vault } = ctx;

  const schema = z.object({
    id: z.string().uuid(),
    tipo: z.enum(['fisica', 'hablar', 'riesgo']),
    compartirUbicacion: z.boolean(),
    ubicacion: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), precisionM: z.number().min(0).max(100_000) })
      .nullish(),
    creadoEn: z.string().datetime(),
    origen: z.enum(['boton', 'resultado_alto', 'acompanante']),
  });

  // Tope técnico contra un equipo con fallas: 30 pedidos por minuto por persona. Si se supera, el
  // aviso NO se pierde: la app lo mantiene en su cola y lo reintenta a los 10 s.
  const limiter = rateLimit({ windowMs: 60_000, max: 30, key: (req) => `em:${req.auth?.userId ?? req.ip}` });

  r.post('/emergency', limiter, async (req, res) => {
    const a = auth(req);
    const e = schema.parse(req.body);
    const prev = db.prepare('SELECT id, canal, recibido_en FROM emergencies WHERE id = ?').get(e.id) as
      | { id: string; canal: string; recibido_en: string; }
      | undefined;
    if (prev) {
      const ack: EmergencyAck = { id: prev.id, estado: 'enviado', canal: prev.canal, recibidoEn: prev.recibido_en };
      return res.json(ack);
    }
    const user = getUser(db, a.userId);
    const org = getOrg(db, user.org_id);
    // La ubicación solo se usa si la persona la compartió en esta pantalla. El consentimiento "geo"
    // se refiere exactamente a este uso; si lo retiró, no se envía.
    const ubicacion = e.compartirUbicacion && e.ubicacion && getConsents(db, a.userId).geo ? e.ubicacion : null;
    const recibido = nowIso();
    const tipo = guardAlertType(e.tipo, e.origen);
    db.prepare(
      `INSERT INTO emergencies (id, user_id, org_id, tipo, origen, ubicacion_enc, creado_cliente, recibido_en, canal, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'recibido')`,
    ).run(e.id, a.userId, a.orgId, e.tipo, e.origen, ubicacion ? vault.encrypt(a.userId, ubicacion) : null, e.creadoEn, recibido, ctx.guard.canal);
    db.prepare(
      'INSERT INTO audit_log (id, org_id, user_id, actor, accion, comparte_datos, detalle, creado_en) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    ).run(
      newId(),
      a.orgId,
      a.userId,
      'trabajador',
      `escalamiento_${tipo}`,
      JSON.stringify({ destinatario: 'guardia', ubicacion: Boolean(ubicacion), emergencia: e.id }),
      recibido,
    );
    // Avisos repetidos: se registran todos, pero la guardia no recibe una notificación por cada uno.
    const desde = new Date(Date.parse(recibido) - VENTANA_MS).toISOString();
    const recientes = (
      db
        .prepare("SELECT tipo, origen, estado FROM emergencies WHERE user_id = ? AND recibido_en >= ? AND id != ?")
        .all(a.userId, desde, e.id) as Array<{ tipo: 'fisica' | 'hablar' | 'riesgo'; origen: EmergencyOrigin; estado: string }>
    ).map((x) => ({ tipo: guardAlertType(x.tipo, x.origen), notificada: !x.estado.includes('agrupado') }));
    if (decideAlert(recientes, tipo) === 'agrupar') {
      db.prepare("UPDATE emergencies SET estado = 'agrupado' WHERE id = ?").run(e.id);
      scheduleGroupFlush(ctx, a.userId);
    } else {
      const delivery = await ctx.guard.notify({
        alertId: e.id,
        orgId: org.id,
        faena: org.faena,
        tipo,
        prioridad: guardAlertPriority(tipo),
        origen: e.origen,
        trabajador: { id: user.id, nombre: user.nombre, legajo: user.legajo, telefono: user.telefono },
        ubicacion,
        creadoEn: e.creadoEn,
      });
      db.prepare('UPDATE emergencies SET estado = ? WHERE id = ?').run(delivery.entregado ? 'entregado' : 'pendiente_entrega', e.id);
      if (!delivery.entregado) {
        // El aviso quedó registrado en el servidor: se reintenta la entrega a la guardia en segundo plano.
        scheduleRedelivery(ctx, e.id);
      }
    }
    const ack: EmergencyAck = { id: e.id, estado: 'enviado', canal: ctx.guard.canal, recibidoEn: recibido };
    res.json(ack);
  });

  r.get('/emergency/:id', (req, res) => {
    const a = auth(req);
    const row = db.prepare('SELECT id, estado, canal, recibido_en FROM emergencies WHERE id = ? AND user_id = ?').get(req.params.id, a.userId);
    if (!row) throw new HttpError(404, 'inexistente');
    res.json(row);
  });

  return r;
}

/**
 * Resumen de avisos agrupados: uno por persona y por minuto como máximo. Toma
 * todos los avisos en estado 'agrupado' de la persona, notifica el más grave
 * con la cantidad y la última ubicación compartida, y los marca entregados.
 */
const groupTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleGroupFlush(ctx: AppContext, userId: string, delayMs = RESUMEN_CADA_MS) {
  if (groupTimers.has(userId)) return;
  const t = setTimeout(() => {
    groupTimers.delete(userId);
    void flushGroup(ctx, userId);
  }, delayMs);
  t.unref();
  groupTimers.set(userId, t);
}

export async function flushGroup(ctx: AppContext, userId: string) {
  const rows = ctx.db
    .prepare("SELECT * FROM emergencies WHERE user_id = ? AND estado = 'agrupado' ORDER BY recibido_en")
    .all(userId) as Array<{ id: string; org_id: string; tipo: 'fisica' | 'hablar' | 'riesgo'; origen: EmergencyOrigin; ubicacion_enc: string | null; creado_cliente: string }>;
  if (!rows.length) return;
  const user = getUser(ctx.db, userId);
  const org = getOrg(ctx.db, user.org_id);
  const tipos = rows.map((r) => guardAlertType(r.tipo, r.origen));
  const tipo = masGrave(tipos);
  const ultima = rows[rows.length - 1]!;
  const conUbicacion = [...rows].reverse().find((r) => r.ubicacion_enc);
  const delivery = await ctx.guard.notify({
    alertId: ultima.id,
    orgId: org.id,
    faena: org.faena,
    tipo,
    prioridad: guardAlertPriority(tipo),
    origen: rows[tipos.indexOf(tipo)]!.origen,
    trabajador: { id: user.id, nombre: user.nombre, legajo: user.legajo, telefono: user.telefono },
    ubicacion: conUbicacion?.ubicacion_enc ? ctx.vault.decrypt(userId, conUbicacion.ubicacion_enc) : null,
    creadoEn: ultima.creado_cliente,
    agrupados: rows.length,
  });
  const ids = rows.map((r) => r.id);
  if (delivery.entregado) {
    ctx.db.prepare(`UPDATE emergencies SET estado = 'entregado_agrupado' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  } else {
    // Sin entrega: se reintenta el resumen en un minuto (los avisos siguen registrados).
    scheduleGroupFlush(ctx, userId);
  }
}

/** Al arrancar el servidor: resúmenes que quedaron pendientes por un reinicio. */
export function flushOrphanGroups(ctx: AppContext) {
  const users = ctx.db.prepare("SELECT DISTINCT user_id FROM emergencies WHERE estado = 'agrupado'").all() as Array<{ user_id: string }>;
  for (const u of users) scheduleGroupFlush(ctx, u.user_id, 1000);
}

const pending = new Set<string>();
function scheduleRedelivery(ctx: AppContext, id: string, attempt = 1) {
  if (pending.has(id) && attempt === 1) return;
  pending.add(id);
  const t = setTimeout(async () => {
    const row = ctx.db.prepare(
      `SELECT e.*, u.nombre, u.legajo, u.telefono, o.faena FROM emergencies e JOIN users u ON u.id = e.user_id JOIN orgs o ON o.id = e.org_id WHERE e.id = ?`,
    ).get(id) as
      | { id: string; user_id: string; org_id: string; tipo: string; origen: string; ubicacion_enc: string | null; creado_cliente: string; estado: string; nombre: string; legajo: string | null; telefono: string | null; faena: string }
      | undefined;
    if (!row || row.estado === 'entregado') return pending.delete(id);
    const origen = row.origen as EmergencyOrigin;
    const tipo = guardAlertType(row.tipo as 'fisica' | 'hablar' | 'riesgo', origen);
    const r = await ctx.guard.notify({
      alertId: row.id,
      orgId: row.org_id,
      faena: row.faena,
      tipo,
      prioridad: guardAlertPriority(tipo),
      origen,
      trabajador: { id: row.user_id, nombre: row.nombre, legajo: row.legajo, telefono: row.telefono },
      ubicacion: row.ubicacion_enc ? ctx.vault.decrypt(row.user_id, row.ubicacion_enc) : null,
      creadoEn: row.creado_cliente,
    });
    if (r.entregado) {
      ctx.db.prepare("UPDATE emergencies SET estado = 'entregado' WHERE id = ?").run(id);
      pending.delete(id);
    } else if (attempt < 60) scheduleRedelivery(ctx, id, attempt + 1);
    else pending.delete(id);
  }, 10_000);
  t.unref();
}
