import { Router } from 'express';
import { z } from 'zod';
import type { DeviceInfo } from '@serena/domain';
import type { AppContext } from '../context.ts';
import { HttpError, auth } from '../auth.ts';
import { nowIso } from '../db.ts';
import { profile } from '../users.ts';

export const consentsSchema = z.object({
  camara: z.boolean(),
  animo: z.boolean(),
  reaccion: z.boolean(),
  chat: z.boolean(),
  geo: z.boolean(),
});

export function upsertConsents(ctx: AppContext, userId: string, deviceId: string, c: z.infer<typeof consentsSchema>, otorgado = true) {
  ctx.db
    .prepare(
      `INSERT INTO consents (user_id, camara, animo, reaccion, chat, geo, otorgado, actualizado_en, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET camara = excluded.camara, animo = excluded.animo, reaccion = excluded.reaccion,
         chat = excluded.chat, geo = excluded.geo, otorgado = excluded.otorgado, actualizado_en = excluded.actualizado_en,
         device_id = excluded.device_id`,
    )
    .run(userId, +c.camara, +c.animo, +c.reaccion, +c.chat, +c.geo, otorgado ? 1 : 0, nowIso(), deviceId);
}

export function meRoutes(ctx: AppContext) {
  const r = Router();
  const { db } = ctx;

  r.get('/me', (req, res) => {
    const a = auth(req);
    res.json({ perfil: profile(db, a.userId), sesion: { deviceId: a.deviceId, deviceKind: a.deviceKind, efimera: a.efimera } });
  });

  /** Consentimiento granular y revocable (6.2 / 6.14). */
  r.put('/consents', (req, res) => {
    const a = auth(req);
    const c = consentsSchema.parse(req.body);
    upsertConsents(ctx, a.userId, a.deviceId, c, true);
    db.prepare('INSERT INTO audit_log (id, org_id, user_id, actor, accion, detalle, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      crypto.randomUUID(),
      a.orgId,
      a.userId,
      'trabajador',
      'consentimiento_actualizado',
      JSON.stringify(c),
      nowIso(),
    );
    res.json({ perfil: profile(db, a.userId) });
  });

  /** Dispositivos y sincronización (6.15). */
  r.get('/devices', (req, res) => {
    const a = auth(req);
    const rows = db
      .prepare('SELECT * FROM devices WHERE user_id = ? AND (cerrado_en IS NULL OR efimero = 0) ORDER BY creado_en')
      .all(a.userId) as Array<{
      id: string;
      kind: DeviceInfo['kind'];
      nombre: string;
      sistema: string;
      efimero: number;
      ultima_sync: string | null;
      cerrado_en: string | null;
    }>;
    // Los kioscos se agrupan: se muestra solo el último usado.
    const kiosks = rows.filter((d) => d.efimero);
    const lastKiosk = kiosks.sort((x, y) => (y.ultima_sync ?? '').localeCompare(x.ultima_sync ?? ''))[0];
    const list: DeviceInfo[] = rows
      .filter((d) => !d.efimero || d === lastKiosk)
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        nombre: d.nombre,
        sistema: d.sistema,
        efimero: !!d.efimero,
        ultimaSync: d.ultima_sync,
        actual: d.id === a.deviceId,
        cerrado: !!d.cerrado_en,
      }));
    res.json({ dispositivos: list });
  });

  /** Cierre remoto de sesión en un dispositivo. */
  r.delete('/devices/:id', (req, res) => {
    const a = auth(req);
    const id = z.string().uuid().parse(req.params.id);
    const d = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(id, a.userId);
    if (!d) throw new HttpError(404, 'dispositivo_inexistente');
    const now = nowIso();
    db.prepare('UPDATE devices SET cerrado_en = ?, trust_hash = NULL, trust_hasta = NULL WHERE id = ?').run(now, id);
    db.prepare('UPDATE sessions SET revocada_en = ? WHERE device_id = ? AND revocada_en IS NULL').run(now, id);
    res.json({ ok: true });
  });

  return r;
}
