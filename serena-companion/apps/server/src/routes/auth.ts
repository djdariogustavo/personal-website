import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, auth, authenticate, openSession } from '../auth.ts';
import { hashSecret, newId, sha256, verifySecret } from '../crypto.ts';
import { nowIso } from '../db.ts';
import { profile, type UserRow } from '../users.ts';
import { rateLimit } from '../ratelimit.ts';
import { SmsNoEnviado } from '../sms/twilio.ts';
import { codigoValido, entregarCodigo, nuevoCodigo } from '../otp.ts';

const deviceSchema = z.object({
  kind: z.enum(['mobile', 'tablet', 'desktop', 'kiosk']),
  nombre: z.string().min(1).max(80),
  sistema: z.string().min(1).max(80),
  id: z.string().uuid().nullish(),
});

/**
 * Ingreso seguro (6.3):
 * 1. Usuario corporativo o DNI + contraseña.
 * 2. Segundo factor: código de 6 dígitos (5 min, 5 intentos), salvo en un
 *    escritorio recordado ("Recordar este dispositivo por 30 días").
 * 3. En el teléfono personal, el PIN de 4 dígitos y la biometría son un
 *    desbloqueo LOCAL de la app (no reemplazan el login).
 * Kiosco: legajo + PIN o QR de la credencial, desde un kiosco registrado.
 */
/**
 * Envía el código de ingreso; si el SMS no sale, lo informa sin exponer detalles del proveedor. El mensaje depende
 * del motivo: invitar a reintentar solo tiene sentido si la falla es pasajera.
 */
async function enviarCodigo(ctx: AppContext, to: { telefono: string | null; email: string | null }, code: string | null) {
  try {
    await entregarCodigo(ctx, to, code, 'ingreso');
  } catch (e) {
    if (e instanceof SmsNoEnviado) throw errorDeSms(e);
    throw e;
  }
}

function errorDeSms(e: SmsNoEnviado): HttpError {
  switch (e.motivo) {
    case 'cuenta':
      return new HttpError(503, 'sms_no_disponible', 'El envío de códigos por SMS no está disponible en este momento y ya lo estamos revisando. Mientras tanto, pedí ayuda a salud ocupacional de tu faena para ingresar.');
    case 'destino':
      return new HttpError(502, 'sms_telefono_invalido', 'No pudimos enviar el SMS al teléfono registrado en tu cuenta. Pedí a salud ocupacional de tu faena que revise tu número.');
    default:
      return new HttpError(502, 'sms_no_enviado', 'No pudimos enviarte el código por SMS. Probá de nuevo en un momento; si sigue fallando, pedí ayuda a salud ocupacional de tu faena.');
  }
}

export function authRoutes(ctx: AppContext) {
  const r = Router();
  const { db } = ctx;
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 10,
    key: (req) => `${req.ip}|${String(req.body?.identificador ?? '').toLowerCase()}`,
  });
  const codeLimiter = rateLimit({ windowMs: 15 * 60_000, max: 300 });
  const kioskLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 10,
    key: (req) => `${sha256(String(req.body?.kioskToken ?? ''))}|${String(req.body?.legajo ?? req.body?.qr ?? '')}`,
  });

  r.post('/login', loginLimiter, async (req, res) => {
    const body = z
      .object({
        identificador: z.string().min(3).max(64),
        password: z.string().min(1).max(200),
        device: deviceSchema,
        trustToken: z.string().max(200).nullish(),
      })
      .parse(req.body);
    const ident = body.identificador.replace(/\./g, '').trim().toLowerCase();
    const u = db
      // Una cuenta dada de baja puede ingresar durante el período de gracia, con alcance restringido (bajaScope).
      .prepare(
        `SELECT * FROM users WHERE (lower(usuario) = ? OR replace(dni, '.', '') = ?)
           AND (activo = 1 OR (role = 'worker' AND purga_en > ?))`,
      )
      .get(ident, ident, nowIso()) as UserRow | undefined;
    // Se verifica igual contra un hash ficticio para no filtrar si el usuario existe por tiempo de respuesta.
    const ok = verifySecret(body.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, 'credenciales', 'El usuario o la contraseña no coinciden.');
    if (body.device.kind === 'kiosk') throw new HttpError(400, 'usar_kiosco');

    // Escritorio recordado: sin segundo factor.
    if (body.trustToken && body.device.id) {
      const d = db
        .prepare('SELECT trust_hash, trust_hasta FROM devices WHERE id = ? AND user_id = ? AND cerrado_en IS NULL')
        .get(body.device.id, u.id) as { trust_hash: string | null; trust_hasta: string | null } | undefined;
      if (d?.trust_hash && d.trust_hasta && Date.parse(d.trust_hasta) > Date.now() && d.trust_hash === sha256(body.trustToken)) {
        const s = await openSession(ctx, u.id, body.device);
        return res.json({ paso: 'listo', ...s, perfil: profile(db, u.id) });
      }
    }

    const challengeId = newId();
    const { codeHash, code } = nuevoCodigo(ctx, challengeId);
    db.prepare(
      `INSERT INTO login_challenges (id, user_id, code_hash, device_kind, device_nombre, device_sistema, vence_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(challengeId, u.id, codeHash, body.device.kind, body.device.nombre, body.device.sistema, new Date(Date.now() + 5 * 60_000).toISOString());
    await enviarCodigo(ctx, { telefono: u.telefono, email: u.email }, code);
    res.json({
      paso: 'segundo_factor',
      challengeId,
      telefonoTermina: u.telefono ? u.telefono.slice(-2) : null,
      ...(ctx.exposeDevOtp && code ? { codigoDesarrollo: code } : {}),
    });
  });

  r.post('/verify', codeLimiter, async (req, res) => {
    const body = z
      .object({
        challengeId: z.string().uuid(),
        codigo: z.string().regex(/^\d{6}$/),
        recordar: z.boolean().default(false),
        device: deviceSchema,
      })
      .parse(req.body);
    const ch = db.prepare('SELECT * FROM login_challenges WHERE id = ?').get(body.challengeId) as
      | { id: string; user_id: string; code_hash: string; intentos: number; vence_en: string; usado: number }
      | undefined;
    if (!ch || ch.usado || Date.parse(ch.vence_en) < Date.now() || ch.intentos >= 5)
      throw new HttpError(401, 'codigo_vencido', 'El código venció. Pedí uno nuevo.');
    const u = db.prepare('SELECT telefono FROM users WHERE id = ?').get(ch.user_id) as { telefono: string | null } | undefined;
    if (!(await codigoValido(ctx, 'login_challenges', ch, u?.telefono ?? null, body.codigo))) {
      db.prepare('UPDATE login_challenges SET intentos = intentos + 1 WHERE id = ?').run(ch.id);
      throw new HttpError(401, 'codigo_incorrecto', 'El código no coincide. Revisá los 6 dígitos o pedí uno nuevo.');
    }
    db.prepare('UPDATE login_challenges SET usado = 1 WHERE id = ?').run(ch.id);
    const s = await openSession(ctx, ch.user_id, body.device, { remember: body.recordar });
    res.json({ paso: 'listo', ...s, perfil: profile(db, ch.user_id) });
  });

  r.post('/resend', codeLimiter, async (req, res) => {
    const { challengeId } = z.object({ challengeId: z.string().uuid() }).parse(req.body);
    const ch = db.prepare('SELECT * FROM login_challenges WHERE id = ? AND usado = 0').get(challengeId) as
      | { id: string; user_id: string }
      | undefined;
    if (!ch) throw new HttpError(404, 'desafio_inexistente');
    const u = db.prepare('SELECT telefono, email FROM users WHERE id = ?').get(ch.user_id) as { telefono: string | null; email: string | null };
    const { codeHash, code } = nuevoCodigo(ctx, ch.id);
    db.prepare('UPDATE login_challenges SET code_hash = ?, intentos = 0, vence_en = ? WHERE id = ?').run(
      codeHash,
      new Date(Date.now() + 5 * 60_000).toISOString(),
      ch.id,
    );
    await enviarCodigo(ctx, u, code);
    res.json({ ok: true, ...(ctx.exposeDevOtp && code ? { codigoDesarrollo: code } : {}) });
  });

  /** Kiosco: sesión efímera. El token del kiosco lo emite un administrador. */
  r.post('/kiosk', kioskLimiter, async (req, res) => {
    const body = z
      .object({
        kioskToken: z.string().min(20).max(200),
        legajo: z.string().max(20).optional(),
        pin: z.string().regex(/^\d{4}$/).optional(),
        qr: z.string().max(300).optional(),
      })
      .parse(req.body);
    const k = db.prepare('SELECT * FROM kiosks WHERE token_hash = ? AND revocado_en IS NULL').get(sha256(body.kioskToken)) as
      | { id: string; org_id: string; nombre: string }
      | undefined;
    if (!k) throw new HttpError(401, 'kiosco_no_registrado');
    let u: UserRow | undefined;
    if (body.qr) {
      u = db.prepare('SELECT * FROM users WHERE qr_token_hash = ? AND org_id = ? AND activo = 1').get(sha256(body.qr), k.org_id) as UserRow | undefined;
    } else if (body.legajo && body.pin) {
      const cand = db.prepare('SELECT * FROM users WHERE legajo = ? AND org_id = ? AND activo = 1').get(body.legajo, k.org_id) as
        | (UserRow & { kiosk_fallos: number; kiosk_bloqueo_hasta: string | null })
        | undefined;
      // Bloqueo por persona, en todos los kioscos: 5 PIN incorrectos → 15 minutos.
      if (cand?.kiosk_bloqueo_hasta && Date.parse(cand.kiosk_bloqueo_hasta) > Date.now())
        throw new HttpError(429, 'pin_bloqueado', 'Demasiados intentos con este legajo. Probá en 15 minutos o usá el QR de tu credencial.');
      const ok = verifySecret(body.pin, cand?.kiosk_pin_hash ?? DUMMY_HASH);
      if (cand && ok) {
        u = cand;
        db.prepare('UPDATE users SET kiosk_fallos = 0, kiosk_bloqueo_hasta = NULL WHERE id = ?').run(cand.id);
      } else if (cand) {
        const fallos = cand.kiosk_fallos + 1;
        const bloqueo = fallos >= KIOSK_PIN_MAX_FALLOS ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
        db.prepare('UPDATE users SET kiosk_fallos = ?, kiosk_bloqueo_hasta = ? WHERE id = ?').run(bloqueo ? 0 : fallos, bloqueo, cand.id);
      }
    }
    if (!u) throw new HttpError(401, 'credencial', 'No pudimos identificarte. Revisá el legajo y el PIN.');
    const s = await openSession(ctx, u.id, { kind: 'kiosk', nombre: k.nombre, sistema: 'Kiosco' });
    res.json({ paso: 'listo', ...s, perfil: profile(db, u.id) });
  });

  r.post('/logout', authenticate(ctx), (req, res) => {
    const a = auth(req);
    db.prepare('UPDATE sessions SET revocada_en = ? WHERE id = ?').run(nowIso(), a.sessionId);
    // Las sesiones de kiosco también dan de baja el registro del dispositivo efímero.
    if (a.efimera) db.prepare('UPDATE devices SET cerrado_en = ? WHERE id = ?').run(nowIso(), a.deviceId);
    res.json({ ok: true });
  });

  return r;
}

const DUMMY_HASH = hashSecret('serena-dummy-password');
const KIOSK_PIN_MAX_FALLOS = 5;
