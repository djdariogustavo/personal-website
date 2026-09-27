import type { NextFunction, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import type { DeviceKind, Role } from '@serena/domain';
import type { AppContext } from './context.ts';
import { newId, newToken, sha256 } from './crypto.ts';
import { nowIso } from './db.ts';

/**
 * Sesiones: un JWT corto (HS256) que referencia una fila de `sessions`. Cada
 * pedido verifica que la sesión no esté revocada (cierre remoto desde
 * Dispositivos) ni vencida por inactividad (5 min en tablet y kiosco, 15 min en
 * escritorio; en el teléfono personal la app además se bloquea con PIN).
 */

export interface AuthInfo {
  userId: string;
  orgId: string;
  role: Role;
  sessionId: string;
  deviceId: string;
  deviceKind: DeviceKind;
  efimera: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthInfo;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const SESSION_TTL_DAYS: Record<DeviceKind, number> = { mobile: 30, tablet: 1, desktop: 1, kiosk: 1 / 24 };

export interface DeviceSpec {
  kind: DeviceKind;
  nombre: string;
  sistema: string;
}

/** Crea (o reutiliza) el registro del dispositivo y abre una sesión. */
export async function openSession(
  ctx: AppContext,
  userId: string,
  device: DeviceSpec & { id?: string | null },
  opts: { remember?: boolean } = {},
): Promise<{ token: string; deviceId: string; trustToken?: string; inactividadS: number }> {
  const { db } = ctx;
  const efimero = device.kind === 'kiosk';
  let deviceId = device.id ?? null;
  if (deviceId) {
    const d = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ? AND cerrado_en IS NULL').get(deviceId, userId);
    if (!d) deviceId = null;
  }
  const now = nowIso();
  if (!deviceId) {
    deviceId = newId();
    db.prepare(
      'INSERT INTO devices (id, user_id, kind, nombre, sistema, efimero, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(deviceId, userId, device.kind, device.nombre.slice(0, 80), device.sistema.slice(0, 80), efimero ? 1 : 0, now);
  }

  let trustToken: string | undefined;
  if (opts.remember && device.kind === 'desktop') {
    // "Recordar este dispositivo por 30 días": omite el segundo factor en este equipo.
    trustToken = newToken();
    const hasta = new Date(Date.now() + 30 * 86_400_000).toISOString();
    db.prepare('UPDATE devices SET trust_hash = ?, trust_hasta = ? WHERE id = ?').run(sha256(trustToken), hasta, deviceId);
  }

  const inactividadS = ctx.config.sesion.inactividadMin[device.kind] * 60;
  const sessionId = newId();
  const vence = new Date(Date.now() + SESSION_TTL_DAYS[device.kind] * 86_400_000).toISOString();
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, creada_en, vence_en, ultimo_uso, inactividad_s) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(sessionId, userId, deviceId, now, vence, now, device.kind === 'mobile' ? 30 * 86_400 : inactividadS);

  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.parse(vence) / 1000))
    .sign(ctx.jwtKey);
  return { token, deviceId, trustToken, inactividadS };
}

interface SessionRow {
  id: string;
  user_id: string;
  device_id: string;
  vence_en: string;
  ultimo_uso: string;
  inactividad_s: number;
  revocada_en: string | null;
  org_id: string;
  role: Role;
  kind: DeviceKind;
  efimero: number;
  cerrado_en: string | null;
  activo: number;
}

export function authenticate(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const h = req.headers.authorization;
      if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'sin_sesion');
      let sid: string;
      try {
        const { payload } = await jwtVerify(h.slice(7), ctx.jwtKey, { algorithms: ['HS256'] });
        sid = String(payload.sid);
      } catch {
        throw new HttpError(401, 'sesion_invalida');
      }
      const s = ctx.db
        .prepare(
          `SELECT s.*, u.org_id, u.role, u.activo, d.kind, d.efimero, d.cerrado_en
           FROM sessions s JOIN users u ON u.id = s.user_id JOIN devices d ON d.id = s.device_id
           WHERE s.id = ?`,
        )
        .get(sid) as SessionRow | undefined;
      if (!s || s.revocada_en || s.cerrado_en || !s.activo) throw new HttpError(401, 'sesion_cerrada');
      const now = Date.now();
      if (Date.parse(s.vence_en) < now) throw new HttpError(401, 'sesion_vencida');
      if (now - Date.parse(s.ultimo_uso) > s.inactividad_s * 1000) {
        ctx.db.prepare('UPDATE sessions SET revocada_en = ? WHERE id = ?').run(nowIso(), s.id);
        throw new HttpError(401, 'sesion_inactividad');
      }
      ctx.db.prepare('UPDATE sessions SET ultimo_uso = ? WHERE id = ?').run(nowIso(), s.id);
      req.auth = {
        userId: s.user_id,
        orgId: s.org_id,
        role: s.role,
        sessionId: s.id,
        deviceId: s.device_id,
        deviceKind: s.kind,
        efimera: Boolean(s.efimero),
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) return next(new HttpError(403, 'sin_permiso'));
    next();
  };
}

export function auth(req: Request): AuthInfo {
  if (!req.auth) throw new HttpError(401, 'sin_sesion');
  return req.auth;
}
