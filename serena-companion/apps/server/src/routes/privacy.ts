import { Router } from 'express';
import type { AppContext } from '../context.ts';
import { HttpError, auth } from '../auth.ts';
import { newId } from '../crypto.ts';
import { nextSeq, nowIso, tx } from '../db.ts';
import { profile } from '../users.ts';
import { upsertConsents } from './me.ts';
import { eliminarCuenta } from '../baja.ts';

/**
 * Privacidad y datos (6.14) — Ley N.º 25.326 (AR): acceso, rectificación y supresión.
 */
export function privacyRoutes(ctx: AppContext) {
  const r = Router();
  const { db, vault } = ctx;

  /** "Tu información se compartió N veces en los últimos 90 días." */
  r.get('/privacy/access-log', (req, res) => {
    const a = auth(req);
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const rows = db
      .prepare('SELECT accion, detalle, creado_en FROM audit_log WHERE user_id = ? AND comparte_datos = 1 AND creado_en >= ? ORDER BY creado_en DESC')
      .all(a.userId, since) as Array<{ accion: string; detalle: string | null; creado_en: string }>;
    res.json({
      compartida90d: rows.length,
      registros: rows.map((x) => ({ accion: x.accion, fecha: x.creado_en, destinatario: 'Guardia de emergencia' })),
    });
  });

  /** Derecho de acceso: exporta todos los datos del usuario en JSON legible. */
  r.get('/privacy/export', (req, res) => {
    const a = auth(req);
    const checkins = (
      db.prepare('SELECT payload_enc FROM checkins WHERE user_id = ? AND borrado = 0 ORDER BY creado_en').all(a.userId) as Array<{ payload_enc: string }>
    ).map((c) => vault.decrypt(a.userId, c.payload_enc));
    const chat = (
      db.prepare('SELECT role, content_enc, creado_en FROM chat_messages WHERE user_id = ? ORDER BY creado_en').all(a.userId) as Array<{
        role: string;
        content_enc: string;
        creado_en: string;
      }>
    ).map((m) => ({ rol: m.role, texto: vault.decrypt(a.userId, m.content_enc), fecha: m.creado_en }));
    const emergencias = (
      db.prepare('SELECT tipo, origen, creado_cliente, recibido_en, canal, estado FROM emergencies WHERE user_id = ?').all(a.userId) as object[]
    );
    const dispositivos = db.prepare('SELECT kind, nombre, sistema, creado_en, ultima_sync, cerrado_en FROM devices WHERE user_id = ?').all(a.userId);
    const accesos = db.prepare('SELECT accion, detalle, creado_en FROM audit_log WHERE user_id = ? ORDER BY creado_en').all(a.userId);
    const out = {
      generado: nowIso(),
      aviso: 'Estos son todos los datos que SERENA Companion guarda sobre vos. No se guardan video, imágenes de tu cara, audio ni plantillas biométricas.',
      perfil: profile(db, a.userId),
      checkins,
      conversacion: chat,
      emergencias,
      dispositivos,
      registroDeAccesos: accesos,
    };
    res.setHeader('content-disposition', `attachment; filename="serena-mis-datos-${nowIso().slice(0, 10)}.json"`);
    res.json(out);
  });

  /** Borrar mi historial: check-ins y conversación, en todos los dispositivos (tombstones para sincronizar). */
  r.delete('/privacy/history', (req, res) => {
    const a = auth(req);
    tx(db, () => {
      const ids = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND borrado = 0').all(a.userId) as Array<{ id: string }>;
      const now = nowIso();
      for (const { id } of ids)
        db.prepare('UPDATE checkins SET borrado = 1, payload_enc = NULL, actualizado_en = ?, device_id = ?, seq = ? WHERE id = ?').run(
          now,
          a.deviceId,
          nextSeq(db),
          id,
        );
      db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(a.userId);
      db.prepare("INSERT INTO audit_log (id, org_id, user_id, actor, accion, creado_en) VALUES (?, ?, ?, 'trabajador', 'historial_borrado', ?)").run(
        newId(),
        a.orgId,
        a.userId,
        now,
      );
    });
    res.json({ ok: true });
  });

  /**
   * Eliminar mi cuenta y todos mis datos, sin esperar al fin del período de
   * gracia. Solo para cuentas dadas de baja: mientras la persona trabaja, la
   * cuenta la administra la empresa (puede borrar su historial y retirar el
   * consentimiento en cualquier momento).
   */
  r.delete('/privacy/account', (req, res) => {
    const a = auth(req);
    if (!a.baja) throw new HttpError(403, 'solo_cuentas_de_baja', 'Podés borrar tu historial o retirar tu consentimiento. La cuenta se elimina cuando la empresa te da de baja.');
    eliminarCuenta(ctx, a.orgId, a.userId, 'trabajador');
    res.json({ ok: true });
  });

  /**
   * Retirar el consentimiento: se dejan de procesar los datos (todos los
   * permisos en falso). El botón de emergencia sigue funcionando.
   */
  r.post('/privacy/withdraw', (req, res) => {
    const a = auth(req);
    upsertConsents(ctx, a.userId, a.deviceId, { camara: false, animo: false, reaccion: false, chat: false, geo: false }, false);
    db.prepare("INSERT INTO audit_log (id, org_id, user_id, actor, accion, creado_en) VALUES (?, ?, ?, 'trabajador', 'consentimiento_retirado', ?)").run(
      newId(),
      a.orgId,
      a.userId,
      nowIso(),
    );
    res.json({ perfil: profile(db, a.userId) });
  });

  return r;
}
