import { Router } from 'express';
import { z } from 'zod';
import { PASSWORD_COPY, PASSWORD_MAX, validarPassword } from '@serena/domain';
import type { AppContext } from '../context.ts';
import { HttpError, auth, requireRole } from '../auth.ts';
import { hashSecret, newId, newOtp, newToken, sha256, verifySecret } from '../crypto.ts';
import { nowIso, tx } from '../db.ts';
import { getUser, profile, type UserRow } from '../users.ts';
import { rateLimit } from '../ratelimit.ts';

/**
 * Contraseñas.
 *
 * - Cambio (con sesión): pide la actual. Cierra las demás sesiones y olvida
 *   los escritorios recordados, para que una contraseña robada deje de servir.
 * - Recuperación por SMS: al mismo teléfono del segundo factor. La respuesta es
 *   idéntica exista o no la cuenta (no se puede averiguar quién usa SERENA).
 *   Código de 6 dígitos, 10 minutos, 5 intentos. Cierra todas las sesiones.
 * - Restablecimiento por la empresa (quien perdió el teléfono): genera una
 *   contraseña temporal que se muestra una vez y obliga a cambiarla al
 *   ingresar. La empresa nunca conoce la contraseña final.
 *
 * Cada cambio se avisa por SMS a la persona y queda en el registro de auditoría.
 */

const RESET_MIN = 10;
const RESET_INTENTOS = 5;

const AVISO = {
  cambiada: 'SERENA: se cambió la contraseña de tu cuenta. Si no fuiste vos, avisá a tu empresa.',
  sms: 'SERENA: se restableció la contraseña de tu cuenta con un código por SMS. Si no fuiste vos, avisá a tu empresa.',
  empresa: 'SERENA: tu empresa restableció la contraseña de tu cuenta. Vas a tener que elegir una nueva al ingresar.',
};

const nuevaSchema = z.string().min(1).max(PASSWORD_MAX * 4);

function exigirPolitica(u: UserRow, nueva: string) {
  const problema = validarPassword(nueva, [u.dni, u.usuario, u.legajo, u.nombre, u.nombre_corto]);
  if (problema) throw new HttpError(400, 'password_debil', PASSWORD_COPY[problema]);
}

/** Cierra sesiones y olvida escritorios recordados, salvo (opcionalmente) la sesión y el dispositivo actuales. */
function cerrarSesiones(ctx: AppContext, userId: string, excepto?: { sessionId: string; deviceId: string }): number {
  const now = nowIso();
  const r = ctx.db
    .prepare('UPDATE sessions SET revocada_en = ? WHERE user_id = ? AND revocada_en IS NULL AND id != ?')
    .run(now, userId, excepto?.sessionId ?? '');
  ctx.db.prepare('UPDATE devices SET trust_hash = NULL, trust_hasta = NULL WHERE user_id = ? AND id != ?').run(userId, excepto?.deviceId ?? '');
  return Number(r.changes);
}

function audit(ctx: AppContext, orgId: string, userId: string, actor: string, accion: string) {
  ctx.db.prepare('INSERT INTO audit_log (id, org_id, user_id, actor, accion, creado_en) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), orgId, userId, actor, accion, nowIso());
}

/** Rutas públicas: recuperación por SMS (se montan bajo /api/auth). */
export function passwordRecoveryRoutes(ctx: AppContext) {
  const r = Router();
  const { db } = ctx;
  const porCuenta = rateLimit({ windowMs: 15 * 60_000, max: 5, key: (req) => `rec:${req.ip}|${String(req.body?.identificador ?? '').toLowerCase()}` });
  const porIp = rateLimit({ windowMs: 15 * 60_000, max: 20, key: (req) => `rec-ip:${req.ip}` });
  const finLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, key: (req) => `rec-fin:${req.ip}` });

  r.post('/recover/start', porIp, porCuenta, (req, res) => {
    const { identificador } = z.object({ identificador: z.string().min(3).max(64) }).parse(req.body);
    const ident = identificador.replace(/\./g, '').trim().toLowerCase();
    // Mismo criterio que el ingreso: cuentas activas y cuentas de baja en período de gracia.
    const u = db
      .prepare(
        `SELECT * FROM users WHERE (lower(usuario) = ? OR replace(dni, '.', '') = ?)
           AND (activo = 1 OR (role = 'worker' AND purga_en > ?))`,
      )
      .get(ident, ident, nowIso()) as UserRow | undefined;
    const conTelefono = u && (u.telefono || u.email) ? u : undefined;
    const id = newId();
    const code = newOtp();
    // Siempre se crea el desafío: la respuesta no revela si la cuenta existe.
    db.prepare('INSERT INTO password_resets (id, user_id, code_hash, vence_en, creado_en) VALUES (?, ?, ?, ?, ?)').run(
      id,
      conTelefono?.id ?? null,
      sha256(`${id}:${code}`),
      new Date(Date.now() + RESET_MIN * 60_000).toISOString(),
      nowIso(),
    );
    // Sin await: el tiempo de respuesta no depende de si se envió un SMS.
    if (conTelefono) void ctx.messenger.sendOtp(conTelefono, code, 'recuperacion').catch((e) => console.error('[serena] SMS de recuperación', e));
    res.json({
      challengeId: id,
      venceEnMin: RESET_MIN,
      ...(ctx.exposeDevOtp && conTelefono ? { codigoDesarrollo: code } : {}),
    });
  });

  r.post('/recover/finish', finLimiter, (req, res) => {
    const b = z.object({ challengeId: z.string().uuid(), codigo: z.string().regex(/^\d{6}$/), nueva: nuevaSchema }).parse(req.body);
    const rs = db.prepare('SELECT * FROM password_resets WHERE id = ?').get(b.challengeId) as
      | { id: string; user_id: string | null; code_hash: string; intentos: number; vence_en: string; usado: number }
      | undefined;
    if (!rs || rs.usado || Date.parse(rs.vence_en) < Date.now() || rs.intentos >= RESET_INTENTOS)
      throw new HttpError(401, 'codigo_vencido', 'El código venció. Pedí uno nuevo.');
    // Un desafío sin cuenta se comporta igual que un código incorrecto.
    if (!rs.user_id || rs.code_hash !== sha256(`${rs.id}:${b.codigo}`)) {
      db.prepare('UPDATE password_resets SET intentos = intentos + 1 WHERE id = ?').run(rs.id);
      throw new HttpError(401, 'codigo_incorrecto', 'El código no coincide. Revisá los 6 dígitos o pedí uno nuevo.');
    }
    const u = getUser(db, rs.user_id);
    // Si la contraseña no cumple, el código sigue valiendo para reintentar con otra.
    exigirPolitica(u, b.nueva);
    tx(db, () => {
      db.prepare('UPDATE users SET password_hash = ?, password_temporal = 0, password_cambiada_en = ? WHERE id = ?').run(hashSecret(b.nueva), nowIso(), u.id);
      db.prepare('UPDATE password_resets SET usado = 1 WHERE user_id = ? AND usado = 0').run(u.id);
      cerrarSesiones(ctx, u.id);
      audit(ctx, u.org_id, u.id, 'trabajador', 'password_restablecida_sms');
    });
    void ctx.messenger.sendAviso(u, AVISO.sms).catch(() => undefined);
    res.json({ ok: true });
  });

  return r;
}

/** Rutas con sesión: cambio propio y restablecimiento por la empresa. */
export function passwordRoutes(ctx: AppContext) {
  const r = Router();
  const { db } = ctx;
  const cambioLimiter = rateLimit({ windowMs: 15 * 60_000, max: 5, key: (req) => `pw:${req.auth?.userId ?? req.ip}` });

  r.post('/me/password', cambioLimiter, (req, res) => {
    const a = auth(req);
    const b = z.object({ actual: z.string().min(1).max(PASSWORD_MAX * 4), nueva: nuevaSchema }).parse(req.body);
    const u = getUser(db, a.userId);
    if (!verifySecret(b.actual, u.password_hash)) throw new HttpError(401, 'password_actual', 'La contraseña actual no coincide.');
    if (b.actual === b.nueva) throw new HttpError(400, 'password_igual', 'La contraseña nueva tiene que ser distinta de la actual.');
    exigirPolitica(u, b.nueva);
    const cerradas = tx(db, () => {
      db.prepare('UPDATE users SET password_hash = ?, password_temporal = 0, password_cambiada_en = ? WHERE id = ?').run(hashSecret(b.nueva), nowIso(), u.id);
      const n = cerrarSesiones(ctx, u.id, { sessionId: a.sessionId, deviceId: a.deviceId });
      audit(ctx, u.org_id, u.id, u.role === 'admin' ? 'empresa' : 'trabajador', 'password_cambiada');
      return n;
    });
    void ctx.messenger.sendAviso(u, AVISO.cambiada).catch(() => undefined);
    res.json({ perfil: profile(db, u.id), sesionesCerradas: cerradas });
  });

  r.post('/admin/workers/:id/password', requireRole('admin'), (req, res) => {
    const a = auth(req);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(String(req.params.id)) as UserRow | undefined;
    if (!u || u.org_id !== a.orgId || u.role !== 'worker') throw new HttpError(404, 'trabajador_inexistente');
    if (!u.activo) throw new HttpError(409, 'dado_de_baja', 'Esta persona está dada de baja. Reactivala primero.');
    const temporal = newToken(9);
    tx(db, () => {
      db.prepare('UPDATE users SET password_hash = ?, password_temporal = 1, password_cambiada_en = ? WHERE id = ?').run(hashSecret(temporal), nowIso(), u.id);
      db.prepare('UPDATE password_resets SET usado = 1 WHERE user_id = ? AND usado = 0').run(u.id);
      cerrarSesiones(ctx, u.id);
      audit(ctx, a.orgId, u.id, 'empresa', 'password_restablecida_empresa');
    });
    void ctx.messenger.sendAviso(u, AVISO.empresa).catch(() => undefined);
    res.json({ passwordTemporal: temporal });
  });

  return r;
}
