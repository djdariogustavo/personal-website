import { Router } from 'express';
import { z } from 'zod';
import { applyConsents, classify, rosterStatus, wins, type CheckIn, type PullResponse, type PushResult } from '@serena/domain';
import type { AppContext } from '../context.ts';
import { auth } from '../auth.ts';
import { nextSeq, nowIso, tx } from '../db.ts';
import { getConsents, getUser } from '../users.ts';
import { consentsSchema, upsertConsents } from './me.ts';

const metrics = z.object({
  pulso: z.number().min(20).max(250),
  hrv: z.number().min(0).max(400),
  respiracion: z.number().min(2).max(80),
  estres: z.number().min(1).max(5),
});

export const checkinSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deviceName: z.string().max(80),
  deviceKind: z.enum(['mobile', 'tablet', 'desktop', 'kiosk']),
  rosterDay: z.number().int().min(1).max(60).nullable(),
  onShift: z.boolean(),
  animo: z.number().int().min(0).max(4).nullable(),
  sueno: z.number().int().min(0).max(3).nullable(),
  escaneo: z.object({ metricas: metrics, calidad: z.number().min(0).max(1), duracionS: z.number().min(0).max(120) }).nullable(),
  reaccion: z.object({ toques: z.number().int().min(0).max(20), mediaMs: z.number().min(0).max(5000), anticipados: z.number().int().min(0).max(20) }).nullable(),
  voz: z.object({ duracionS: z.number().min(0).max(60), nivelMedio: z.number().min(0).max(1) }).nullable(),
  nivel: z.enum(['bajo', 'moderado', 'alto']),
  nota: z.string().max(1000).nullable(),
});

const mutationSchema = z.discriminatedUnion('entity', [
  z.object({
    mutationId: z.string().uuid(),
    entity: z.literal('checkin'),
    id: z.string().uuid(),
    op: z.enum(['upsert', 'delete']),
    data: checkinSchema.nullable(),
    updatedAt: z.string().datetime(),
    deviceId: z.string(),
  }),
  z.object({
    mutationId: z.string().uuid(),
    entity: z.literal('consents'),
    id: z.string(),
    op: z.literal('upsert'),
    data: consentsSchema,
    updatedAt: z.string().datetime(),
    deviceId: z.string(),
  }),
]);

interface CheckinRow {
  id: string;
  user_id: string;
  device_id: string;
  creado_en: string;
  actualizado_en: string;
  nivel: string;
  payload_enc: string | null;
  borrado: number;
  seq: number;
}

export function checkinRoutes(ctx: AppContext) {
  const r = Router();
  const { db, vault } = ctx;

  /** Sube la cola de cambios del dispositivo. Idempotente por mutationId. */
  r.post('/sync/push', (req, res) => {
    const a = auth(req);
    const { mutations } = z.object({ mutations: z.array(z.unknown()).max(500) }).parse(req.body);
    const user = getUser(db, a.userId);
    const results: PushResult[] = [];

    for (const raw of mutations) {
      const parsed = mutationSchema.safeParse(raw);
      const mid = (raw as { mutationId?: string })?.mutationId ?? 'desconocida';
      if (!parsed.success) {
        results.push({ mutationId: mid, status: 'rechazada', motivo: 'formato' });
        continue;
      }
      const m = parsed.data;
      // El dispositivo que dice originar el cambio debe ser el de la sesión (evita suplantación entre dispositivos).
      const deviceId = a.deviceId;
      const dup = db.prepare('SELECT 1 FROM sync_mutations WHERE mutation_id = ?').get(m.mutationId);
      if (dup) {
        results.push({ mutationId: m.mutationId, status: 'duplicada' });
        continue;
      }

      const result = tx(db, (): Omit<PushResult, 'mutationId'> => {
        db.prepare('INSERT INTO sync_mutations (mutation_id, user_id, aplicada_en) VALUES (?, ?, ?)').run(m.mutationId, a.userId, nowIso());
        if (m.entity === 'consents') {
          upsertConsents(ctx, a.userId, deviceId, m.data, true);
          return { status: 'aplicada' };
        }
        const cur = db.prepare('SELECT * FROM checkins WHERE id = ?').get(m.id) as CheckinRow | undefined;
        if (cur && cur.user_id !== a.userId) return { status: 'rechazada', motivo: 'ajeno' };
        // Desde el kiosco solo se crean registros nuevos de esa sesión; nunca se tocan los de otros dispositivos.
        if (a.efimera && cur && cur.device_id !== a.deviceId) return { status: 'rechazada', motivo: 'kiosco' };
        if (!wins({ updatedAt: m.updatedAt, deviceId }, cur ? { updatedAt: cur.actualizado_en, deviceId: cur.device_id } : null))
          return { status: 'descartada' };
        const seq = nextSeq(db);
        if (m.op === 'delete') {
          if (!cur) return { status: 'descartada' };
          db.prepare('UPDATE checkins SET borrado = 1, payload_enc = NULL, actualizado_en = ?, device_id = ?, seq = ? WHERE id = ?').run(
            m.updatedAt,
            deviceId,
            seq,
            m.id,
          );
          return { status: 'aplicada' };
        }
        // El consentimiento vigente se aplica en el servidor, no solo en la app.
        const { otorgado, ...consents } = getConsents(db, a.userId);
        const decision = applyConsents(m.data! as CheckIn, consents, otorgado);
        if (!decision.ok) return { status: 'rechazada', motivo: decision.motivo };
        const c = decision.checkin;
        // El nivel se recalcula en el servidor con la configuración vigente (no se confía en el cliente).
        const nivel = classify({ animo: c.animo as never, sueno: c.sueno as never, escaneo: c.escaneo, reaccion: c.reaccion }, ctx.config.niveles);
        const st = rosterStatus(
          { inicio: user.roster_inicio, diasTrabajo: user.roster_trabajo, diasDescanso: user.roster_descanso },
          new Date(c.createdAt),
        );
        const payload = { ...c, nivel, userId: a.userId, deviceId: cur?.device_id ?? deviceId };
        db.prepare(
          `INSERT INTO checkins (id, user_id, org_id, device_id, creado_en, actualizado_en, nivel, en_turno, dia_roster, payload_enc, borrado, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(id) DO UPDATE SET actualizado_en = excluded.actualizado_en, nivel = excluded.nivel,
             payload_enc = excluded.payload_enc, borrado = 0, seq = excluded.seq`,
        ).run(
          c.id,
          a.userId,
          a.orgId,
          cur?.device_id ?? deviceId,
          c.createdAt,
          m.updatedAt,
          nivel,
          st.enTurno ? 1 : 0,
          st.enTurno ? st.dia : null,
          vault.encrypt(a.userId, payload),
          seq,
        );
        return { status: 'aplicada' };
      });
      results.push({ mutationId: m.mutationId, ...result });
    }
    db.prepare('UPDATE devices SET ultima_sync = ? WHERE id = ?').run(nowIso(), a.deviceId);
    res.json({ resultados: results });
  });

  /** Baja los cambios posteriores al cursor (sincronización incremental). */
  r.get('/sync/pull', (req, res) => {
    const a = auth(req);
    const since = Number(z.string().regex(/^\d+$/).default('0').parse(req.query.cursor ?? '0'));
    const limit = 200;
    // En el kiosco solo se devuelve lo registrado en esa misma sesión (cada ingreso al kiosco
    // es un dispositivo efímero nuevo): la tablet compartida nunca recibe el historial.
    const rows = (
      a.efimera
        ? db
            .prepare('SELECT * FROM checkins WHERE user_id = ? AND device_id = ? AND seq > ? ORDER BY seq LIMIT ?')
            .all(a.userId, a.deviceId, since, limit + 1)
        : db.prepare('SELECT * FROM checkins WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(a.userId, since, limit + 1)
    ) as unknown as CheckinRow[];
    const page = rows.slice(0, limit);
    const devices = new Map<string, string>();
    const out: PullResponse<CheckIn> = {
      cursor: String(page.length ? page[page.length - 1]!.seq : since),
      hayMas: rows.length > limit,
      cambios: page.map((row) => {
        if (!devices.has(row.device_id)) {
          const d = db.prepare('SELECT nombre FROM devices WHERE id = ?').get(row.device_id) as { nombre: string } | undefined;
          devices.set(row.device_id, d?.nombre ?? '');
        }
        const data = row.borrado || !row.payload_enc ? null : vault.decrypt<CheckIn>(a.userId, row.payload_enc);
        return {
          entity: 'checkin' as const,
          id: row.id,
          deleted: !!row.borrado,
          data,
          updatedAt: row.actualizado_en,
          deviceId: row.device_id,
        };
      }),
    };
    db.prepare('UPDATE devices SET ultima_sync = ? WHERE id = ?').run(nowIso(), a.deviceId);
    res.json(out);
  });

  return r;
}
