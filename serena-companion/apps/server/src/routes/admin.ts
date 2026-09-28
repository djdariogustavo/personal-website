import { Router } from 'express';
import { z } from 'zod';
import { isEntitled, K_CELDA, K_GRUPO, publicarDistribucion, publicarTotal, ultimoPorPersona, ventanaReporte, type Level } from '@serena/domain';
import type { AppContext } from '../context.ts';
import { HttpError, auth } from '../auth.ts';
import { hashSecret, newId, newPin, newToken, sha256 } from '../crypto.ts';
import { nowIso } from '../db.ts';
import { getOrg, getUser } from '../users.ts';
import { getSubscriptionRow, subscriptionSummary } from '../payments/index.ts';
import { SandboxProvider } from '../payments/sandbox.ts';

/**
 * Administración de la organización. La empresa SOLO ve estadísticas anónimas
 * del grupo (nunca un nombre ni un resultado individual) y gestiona el pago.
 */
export function adminRoutes(ctx: AppContext) {
  const r = Router();
  const { db } = ctx;

  /**
   * Estadísticas agregadas por día de roster, con control de divulgación
   * (ver packages/domain/src/disclosure.ts): unidad persona, grupo ≥ 5, celdas
   * ≥ 3, sin grupos homogéneos, proporciones redondeadas y ventana semanal fija.
   */
  r.get('/admin/stats', (req, res) => {
    const a = auth(req);
    const sub = subscriptionSummary(db, a.orgId);
    if (!isEntitled(sub.estado)) throw new HttpError(402, 'suscripcion_inactiva', 'Los reportes requieren una suscripción activa.');
    const { desde, hasta } = ventanaReporte();
    const participacion = db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS personas, COUNT(*) AS checkins FROM checkins
         WHERE org_id = ? AND borrado = 0 AND creado_en >= ? AND creado_en < ?`,
      )
      .get(a.orgId, desde, hasta) as { personas: number; checkins: number };
    const activos = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND role = 'worker' AND activo = 1").get(a.orgId) as { n: number }).n;
    const filas = db
      .prepare(
        `SELECT dia_roster AS dia, user_id AS userId, nivel FROM checkins
         WHERE org_id = ? AND borrado = 0 AND en_turno = 1 AND dia_roster IS NOT NULL AND creado_en >= ? AND creado_en < ?
         ORDER BY creado_en`,
      )
      .all(a.orgId, desde, hasta) as Array<{ dia: number; userId: string; nivel: Level }>;
    const porDia = new Map<number, Array<{ userId: string; nivel: Level }>>();
    for (const f of filas) porDia.set(f.dia, [...(porDia.get(f.dia) ?? []), f]);
    const escalamientos = (
      db.prepare('SELECT COUNT(*) AS n FROM emergencies WHERE org_id = ? AND recibido_en >= ? AND recibido_en < ?').get(a.orgId, desde, hasta) as { n: number }
    ).n;
    const hayGrupo = participacion.personas >= K_GRUPO;
    res.json({
      periodo: { desde, hasta },
      ventanaDias: 28,
      kAnonimato: K_GRUPO,
      kCelda: K_CELDA,
      participacion: hayGrupo ? { ...participacion, activos } : { personas: null, checkins: null, activos },
      porDiaDeRoster: [...porDia.keys()]
        .sort((x, y) => x - y)
        .map((dia) => ({ dia, ...publicarDistribucion(ultimoPorPersona(porDia.get(dia)!)) })),
      // Los escalamientos se informan solo como total del período, sin fecha ni persona.
      escalamientos28d: publicarTotal(escalamientos) ?? `menos de ${K_GRUPO}`,
    });
  });

  /** Registrar un kiosco (tablet fija). El token se muestra una sola vez. */
  r.post('/admin/kiosks', (req, res) => {
    const a = auth(req);
    const { nombre } = z.object({ nombre: z.string().min(2).max(80) }).parse(req.body);
    const token = newToken();
    const id = newId();
    db.prepare('INSERT INTO kiosks (id, org_id, nombre, token_hash, creado_en) VALUES (?, ?, ?, ?, ?)').run(id, a.orgId, nombre, sha256(token), nowIso());
    res.status(201).json({ id, nombre, token });
  });

  r.get('/admin/kiosks', (req, res) => {
    const a = auth(req);
    res.json({ kioscos: db.prepare('SELECT id, nombre, creado_en, revocado_en FROM kiosks WHERE org_id = ? ORDER BY creado_en').all(a.orgId) });
  });

  r.delete('/admin/kiosks/:id', (req, res) => {
    const a = auth(req);
    db.prepare('UPDATE kiosks SET revocado_en = ? WHERE id = ? AND org_id = ?').run(nowIso(), req.params.id, a.orgId);
    res.json({ ok: true });
  });

  /** Alta de un trabajador. Respeta la cantidad de puestos contratados. Las credenciales iniciales se muestran una vez. */
  r.post('/admin/workers', (req, res) => {
    const a = auth(req);
    const b = z
      .object({
        nombre: z.string().min(3).max(120),
        nombreCorto: z.string().min(1).max(40),
        puesto: z.string().max(80).default(''),
        dni: z.string().regex(/^[\d.]{7,12}$/),
        legajo: z.string().min(1).max(20),
        telefono: z.string().max(30).optional(),
        rosterInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        diasTrabajo: z.number().int().min(1).max(42).default(14),
        diasDescanso: z.number().int().min(1).max(42).default(14),
        turno: z.enum(['dia', 'noche']).default('dia'),
      })
      .parse(req.body);
    const sub = subscriptionSummary(db, a.orgId);
    if (isEntitled(sub.estado) && sub.puestosEnUso >= sub.puestos)
      throw new HttpError(409, 'sin_puestos', 'No quedan puestos disponibles en la suscripción. Ampliá la cantidad en Facturación.');
    const password = newToken(9);
    const pin = newPin();
    const qr = newToken(24);
    const id = newId();
    db.prepare(
      `INSERT INTO users (id, org_id, role, nombre, nombre_corto, puesto, dni, legajo, telefono, password_hash, kiosk_pin_hash, qr_token_hash,
        roster_inicio, roster_trabajo, roster_descanso, turno, creado_en)
       VALUES (?, ?, 'worker', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      a.orgId,
      b.nombre,
      b.nombreCorto,
      b.puesto,
      b.dni,
      b.legajo,
      b.telefono ?? null,
      hashSecret(password),
      hashSecret(pin),
      sha256(qr),
      b.rosterInicio,
      b.diasTrabajo,
      b.diasDescanso,
      b.turno,
      nowIso(),
    );
    res.status(201).json({ id, credenciales: { dni: b.dni, passwordInicial: password, pinKiosco: pin, qrCredencial: qr } });
  });

  // ---------- Facturación ----------

  r.get('/admin/billing', (req, res) => {
    const a = auth(req);
    res.json({
      suscripcion: subscriptionSummary(db, a.orgId),
      planes: ctx.payments.plans,
      proveedores: ctx.payments.list().map((p) => ({ id: p.id, nombre: p.nombre, monedas: p.monedas })),
    });
  });

  r.post('/admin/billing/checkout', async (req, res) => {
    const a = auth(req);
    const b = z
      .object({ proveedor: z.string(), planId: z.string(), puestos: z.number().int().min(1).max(100_000), moneda: z.string().length(3) })
      .parse(req.body);
    const provider = ctx.payments.get(b.proveedor);
    if (!provider) throw new HttpError(400, 'proveedor_no_disponible');
    const plan = ctx.payments.plan(b.planId);
    if (!plan) throw new HttpError(400, 'plan_inexistente');
    if (!provider.monedas.includes(b.moneda)) throw new HttpError(400, 'moneda_no_soportada');
    if (b.puestos < plan.minimoPuestos) throw new HttpError(400, 'minimo_puestos', `El plan requiere al menos ${plan.minimoPuestos} puestos.`);
    const current = getSubscriptionRow(db, a.orgId);
    if (current && (current.estado === 'activa' || current.estado === 'en_prueba') && current.externo_suscripcion)
      throw new HttpError(409, 'ya_suscripta', 'La organización ya tiene una suscripción activa. Gestionala desde el portal del proveedor.');
    const admin = getUser(db, a.userId);
    const org = getOrg(db, a.orgId);
    const checkoutId = newId();
    const out = await provider.createCheckout({
      checkoutId,
      org: { id: org.id, nombre: org.nombre },
      plan,
      puestos: b.puestos,
      moneda: b.moneda,
      payerEmail: admin.email ?? `${admin.usuario ?? admin.id}@example.invalid`,
      successUrl: `${ctx.publicUrl}/admin/facturacion?resultado=ok`,
      cancelUrl: `${ctx.publicUrl}/admin/facturacion?resultado=cancelado`,
    });
    db.prepare(
      "INSERT INTO checkout_sessions (id, org_id, proveedor, plan_id, puestos, moneda, externo_id, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, 'abierto', ?)",
    ).run(checkoutId, a.orgId, provider.id, plan.id, b.puestos, b.moneda, out.externoId, nowIso());
    if (!current) db.prepare("INSERT INTO subscriptions (org_id, proveedor, plan_id, estado, puestos, moneda, actualizada_en) VALUES (?, ?, ?, 'pendiente', ?, ?, ?)").run(a.orgId, provider.id, plan.id, b.puestos, b.moneda, nowIso());
    db.prepare("INSERT INTO audit_log (id, org_id, user_id, actor, accion, detalle, creado_en) VALUES (?, ?, ?, 'admin', 'checkout_iniciado', ?, ?)").run(
      newId(),
      a.orgId,
      a.userId,
      JSON.stringify({ proveedor: provider.id, plan: plan.id, puestos: b.puestos }),
      nowIso(),
    );
    res.json({ url: out.url, checkoutId });
  });

  r.post('/admin/billing/cancel', async (req, res) => {
    const a = auth(req);
    const s = getSubscriptionRow(db, a.orgId);
    if (!s?.externo_suscripcion || !s.proveedor) throw new HttpError(404, 'sin_suscripcion');
    const p = ctx.payments.get(s.proveedor);
    if (!p) throw new HttpError(400, 'proveedor_no_disponible');
    await p.cancel(s.externo_suscripcion);
    db.prepare('UPDATE subscriptions SET cancelada_al_final = 1, actualizada_en = ? WHERE org_id = ?').run(nowIso(), a.orgId);
    if (p.id === 'sandbox' || p.id === 'mercadopago') {
      // Mercado Pago cancela en el acto; la pasarela de prueba lo imita.
      db.prepare("UPDATE subscriptions SET estado = 'cancelada', actualizada_en = ? WHERE org_id = ?").run(nowIso(), a.orgId);
    }
    res.json({ suscripcion: subscriptionSummary(db, a.orgId) });
  });

  r.post('/admin/billing/portal', async (req, res) => {
    const a = auth(req);
    const s = getSubscriptionRow(db, a.orgId);
    const p = s?.proveedor ? ctx.payments.get(s.proveedor) : undefined;
    if (!s?.externo_cliente || !p?.portalUrl) throw new HttpError(404, 'portal_no_disponible');
    res.json({ url: await p.portalUrl(s.externo_cliente, `${ctx.publicUrl}/admin/facturacion`) });
  });

  /**
   * Solo pasarela de prueba: simula la decisión del pagador y dispara el webhook
   * firmado contra el propio servidor, igual que haría un proveedor real.
   */
  r.post('/admin/billing/sandbox/complete', async (req, res) => {
    const a = auth(req);
    const { checkoutId, aprobado } = z.object({ checkoutId: z.string().uuid(), aprobado: z.boolean() }).parse(req.body);
    const p = ctx.payments.get('sandbox');
    if (!(p instanceof SandboxProvider)) throw new HttpError(404, 'sandbox_desactivado');
    const ch = db.prepare("SELECT * FROM checkout_sessions WHERE id = ? AND org_id = ? AND proveedor = 'sandbox'").get(checkoutId, a.orgId) as
      | { puestos: number }
      | undefined;
    if (!ch) throw new HttpError(404, 'checkout_inexistente');
    const ev = p.buildEvent(checkoutId, a.orgId, ch.puestos, aprobado);
    res.json({ webhook: { body: ev.body, signature: ev.signature } });
  });

  return r;
}
