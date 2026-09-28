import type { AppContext } from './context.ts';
import { HttpError } from './auth.ts';
import { hashSecret, newId, newPin, newToken, sha256 } from './crypto.ts';
import { nowIso, tx } from './db.ts';

/**
 * Baja de trabajadores.
 *
 * - La empresa da de baja: se libera el puesto, se cierran todas las sesiones
 *   y dispositivos, y se invalidan PIN de kiosco, QR y escritorios recordados.
 * - La persona conserva durante BAJA_GRACIA_DIAS un acceso restringido
 *   (bajaScope) para descargar o eliminar sus datos (Ley 25.326, acceso y
 *   supresión). La empresa nunca ve esos datos.
 * - Al vencer el período, la cuenta y todos sus datos se eliminan.
 * - Dentro del período, la empresa puede reactivar (si hay puesto); se emiten
 *   PIN y QR nuevos. La contraseña de la persona no cambia.
 */

export const BAJA_GRACIA_DIAS = 30;

interface Row {
  id: string;
  org_id: string;
  role: string;
  activo: number;
  purga_en: string | null;
}

function worker(ctx: AppContext, orgId: string, userId: string): Row {
  const u = ctx.db.prepare('SELECT id, org_id, role, activo, purga_en FROM users WHERE id = ?').get(userId) as Row | undefined;
  // Otra organización o un administrador: se responde igual que si no existiera.
  if (!u || u.org_id !== orgId || u.role !== 'worker') throw new HttpError(404, 'trabajador_inexistente');
  return u;
}

function audit(ctx: AppContext, orgId: string, userId: string | null, actor: string, accion: string) {
  ctx.db.prepare('INSERT INTO audit_log (id, org_id, user_id, actor, accion, creado_en) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), orgId, userId, actor, accion, nowIso());
}

export function darDeBaja(ctx: AppContext, orgId: string, userId: string, ahora = new Date()) {
  const u = worker(ctx, orgId, userId);
  if (!u.activo) throw new HttpError(409, 'ya_dado_de_baja', 'Esta persona ya está dada de baja.');
  const desde = ahora.toISOString();
  const purgaEn = new Date(ahora.getTime() + BAJA_GRACIA_DIAS * 86_400_000).toISOString();
  tx(ctx.db, () => {
    ctx.db
      .prepare('UPDATE users SET activo = 0, baja_en = ?, purga_en = ?, kiosk_pin_hash = NULL, qr_token_hash = NULL, kiosk_fallos = 0, kiosk_bloqueo_hasta = NULL WHERE id = ?')
      .run(desde, purgaEn, userId);
    ctx.db.prepare('UPDATE sessions SET revocada_en = ? WHERE user_id = ? AND revocada_en IS NULL').run(desde, userId);
    ctx.db.prepare('UPDATE devices SET cerrado_en = ?, trust_hash = NULL, trust_hasta = NULL WHERE user_id = ? AND cerrado_en IS NULL').run(desde, userId);
    audit(ctx, orgId, userId, 'empresa', 'baja');
  });
  return { desde, purgaEn };
}

export function reactivar(ctx: AppContext, orgId: string, userId: string, hayPuesto: boolean) {
  const u = worker(ctx, orgId, userId);
  if (u.activo) throw new HttpError(409, 'ya_activo', 'Esta persona ya está activa.');
  if (!hayPuesto) throw new HttpError(409, 'sin_puestos', 'No quedan puestos disponibles en la suscripción. Ampliá la cantidad en Facturación.');
  const pin = newPin();
  const qr = newToken(24);
  tx(ctx.db, () => {
    ctx.db
      .prepare('UPDATE users SET activo = 1, baja_en = NULL, purga_en = NULL, kiosk_pin_hash = ?, qr_token_hash = ? WHERE id = ?')
      .run(hashSecret(pin), sha256(qr), userId);
    audit(ctx, orgId, userId, 'empresa', 'reactivacion');
  });
  return { pinKiosco: pin, qrCredencial: qr };
}

/**
 * Elimina la cuenta y todos sus datos (check-ins, conversación, avisos,
 * dispositivos, sesiones, permisos y registro de accesos). En la organización
 * queda solo un asiento de auditoría sin identidad.
 */
export function eliminarCuenta(ctx: AppContext, orgId: string, userId: string, actor: 'trabajador' | 'sistema') {
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM sync_mutations WHERE user_id = ?').run(userId);
    ctx.db.prepare('DELETE FROM audit_log WHERE user_id = ?').run(userId);
    // ON DELETE CASCADE: consents, devices, sessions, login_challenges, checkins, chat_messages, emergencies.
    ctx.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    audit(ctx, orgId, null, actor, actor === 'trabajador' ? 'cuenta_eliminada_por_la_persona' : 'cuenta_eliminada_fin_de_gracia');
  });
}

/** Elimina las cuentas cuyo período de gracia venció. Devuelve cuántas. */
export function purgarVencidas(ctx: AppContext, ahora = new Date()): number {
  const vencidas = ctx.db
    .prepare("SELECT id, org_id FROM users WHERE activo = 0 AND role = 'worker' AND purga_en IS NOT NULL AND purga_en <= ?")
    .all(ahora.toISOString()) as Array<{ id: string; org_id: string }>;
  for (const v of vencidas) eliminarCuenta(ctx, v.org_id, v.id, 'sistema');
  return vencidas.length;
}
