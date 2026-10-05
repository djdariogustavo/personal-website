import { Router } from 'express';
import { z } from 'zod';
import { rosterStatus } from '@serena/domain';
import type { AppContext } from '../context.ts';
import { HttpError, auth } from '../auth.ts';
import { newId } from '../crypto.ts';
import { nowIso } from '../db.ts';
import { getConsents, getOrg, getUser } from '../users.ts';
import { rateLimit } from '../ratelimit.ts';

/**
 * Conversación con el acompañante. Los mensajes se guardan cifrados con la
 * clave del usuario y solo el propio usuario puede leerlos. En sesiones de
 * kiosco no se muestra el historial (pantalla compartida).
 */
export function companionRoutes(ctx: AppContext) {
  const r = Router();
  const { db, vault } = ctx;
  const limiter = rateLimit({ windowMs: 60_000, max: 20, key: (req) => req.auth?.userId ?? req.ip ?? '' });

  r.get('/companion/messages', (req, res) => {
    const a = auth(req);
    if (a.efimera) return res.json({ mensajes: [], cuidado: false });
    const rows = db
      .prepare('SELECT id, role, content_enc, creado_en, riesgo FROM chat_messages WHERE user_id = ? ORDER BY creado_en DESC LIMIT 200')
      .all(a.userId) as Array<{ id: string; role: 'user' | 'companion'; content_enc: string; creado_en: string; riesgo: string }>;
    rows.reverse();
    // El estado de cuidado sigue activo si hubo riesgo alto en las últimas 24 h.
    const cuidado = rows.some((m) => m.riesgo === 'alto' && Date.now() - Date.parse(m.creado_en) < 86_400_000);
    res.json({
      mensajes: rows.map((m) => ({ id: m.id, role: m.role, text: vault.decrypt<string>(a.userId, m.content_enc), createdAt: m.creado_en })),
      cuidado,
    });
  });

  r.post('/companion/messages', limiter, async (req, res) => {
    const a = auth(req);
    const { text, id } = z.object({ text: z.string().trim().min(1).max(2000), id: z.string().uuid().optional() }).parse(req.body);
    if (!getConsents(db, a.userId).chat) throw new HttpError(403, 'sin_consentimiento', 'Activá la conversación con el acompañante en Privacidad.');
    const user = getUser(db, a.userId);
    const org = getOrg(db, user.org_id);

    const history = a.efimera
      ? []
      : (db
          .prepare('SELECT role, content_enc FROM chat_messages WHERE user_id = ? ORDER BY creado_en DESC LIMIT 30')
          .all(a.userId) as Array<{ role: 'user' | 'companion'; content_enc: string }>)
          .reverse()
          .map((m) => ({ role: m.role, text: vault.decrypt<string>(a.userId, m.content_enc) }));

    const st = rosterStatus({ inicio: user.roster_inicio, diasTrabajo: user.roster_trabajo, diasDescanso: user.roster_descanso });
    const rosterTexto = st.enTurno
      ? `está en el día ${st.dia} de ${st.total} de su roster, turno ${user.turno === 'noche' ? 'noche' : 'día'}`
      : `está en su descanso, día ${st.dia} de ${st.total}, en su casa`;

    const reply = await ctx.companion.reply(history, text, { nombre: user.nombre_corto, rosterTexto, faena: org.faena });

    const now = new Date();
    const userMsg = { id: id ?? newId(), role: 'user' as const, text, createdAt: now.toISOString() };
    const botMsg = { id: newId(), role: 'companion' as const, text: reply.text, createdAt: new Date(now.getTime() + 1).toISOString() };
    const ins = db.prepare('INSERT OR IGNORE INTO chat_messages (id, user_id, role, content_enc, creado_en, riesgo) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run(userMsg.id, a.userId, 'user', vault.encrypt(a.userId, text), userMsg.createdAt, reply.riesgo);
    ins.run(botMsg.id, a.userId, 'companion', vault.encrypt(a.userId, reply.text), botMsg.createdAt, 'ninguno');
    if (reply.cuidado) {
      // Se registra que se activó el estado de cuidado, sin el contenido de la conversación.
      db.prepare('INSERT INTO audit_log (id, org_id, user_id, actor, accion, comparte_datos, creado_en) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
        newId(),
        a.orgId,
        a.userId,
        'sistema',
        'acompanante_estado_cuidado',
        nowIso(),
      );
    }
    res.json({ mensajes: [userMsg, botMsg], cuidado: reply.cuidado, riesgo: reply.riesgo });
  });

  return r;
}
