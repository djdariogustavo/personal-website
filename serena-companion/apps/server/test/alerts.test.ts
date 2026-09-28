import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { decideAlert, masGrave } from '../src/alertThrottle.ts';
import { flushGroup } from '../src/routes/safety.ts';
import { addUser, login, makeCtx } from './helpers.ts';

describe('regla de avisos repetidos', () => {
  const n = (tipo: 'hablar' | 'riesgo' | 'emergencia_fisica', notificada = true) => ({ tipo, notificada });
  it('las primeras tres se notifican por separado', () => {
    expect(decideAlert([], 'hablar')).toBe('notificar');
    expect(decideAlert([n('hablar'), n('hablar')], 'hablar')).toBe('notificar');
  });
  it('desde la cuarta del mismo nivel se agrupan', () => {
    expect(decideAlert([n('hablar'), n('hablar'), n('hablar')], 'hablar')).toBe('agrupar');
    expect(decideAlert([n('riesgo'), n('riesgo'), n('riesgo'), n('riesgo', false)], 'hablar')).toBe('agrupar');
  });
  it('si la situación se agrava se notifica al instante', () => {
    expect(decideAlert([n('hablar'), n('hablar'), n('hablar')], 'riesgo')).toBe('notificar');
    expect(decideAlert([n('riesgo'), n('riesgo'), n('riesgo')], 'emergencia_fisica')).toBe('notificar');
    expect(decideAlert([n('emergencia_fisica'), n('hablar'), n('hablar')], 'riesgo')).toBe('agrupar');
  });
  it('el resumen informa el tipo más grave', () => {
    expect(masGrave(['hablar', 'riesgo', 'hablar'])).toBe('riesgo');
    expect(masGrave(['hablar', 'emergencia_fisica', 'riesgo'])).toBe('emergencia_fisica');
  });
});

describe('avisos repetidos por la API', () => {
  async function setup() {
    const env = makeCtx();
    addUser(env.ctx, env.orgId, { dni: '3030303', legajo: '1', password: 'p' });
    const s = await login(env.app, env.messenger, '3030303', 'p');
    const send = (tipo: string, extra: Record<string, unknown> = {}) =>
      request(env.app)
        .post('/api/emergency')
        .set({ authorization: `Bearer ${s.token}` })
        .send({ id: randomUUID(), tipo, compartirUbicacion: false, creadoEn: new Date().toISOString(), origen: 'boton', ...extra });
    return { ...env, s, send };
  }

  it('toda la ráfaga se confirma y se registra, pero la guardia recibe 3 avisos y un resumen', async () => {
    const t = await setup();
    const acks = [];
    for (let i = 0; i < 7; i++) acks.push(await t.send('hablar'));
    expect(acks.every((r) => r.status === 200 && r.body.estado === 'enviado')).toBe(true);
    expect(t.guard.sent).toHaveLength(3);
    const stored = t.ctx.db.prepare("SELECT estado, COUNT(*) n FROM emergencies GROUP BY estado ORDER BY estado").all();
    expect(stored).toEqual([
      { estado: 'agrupado', n: 4 },
      { estado: 'entregado', n: 3 },
    ]);
    const userId = (t.ctx.db.prepare('SELECT user_id FROM emergencies LIMIT 1').get() as { user_id: string }).user_id;
    await flushGroup(t.ctx, userId);
    expect(t.guard.sent).toHaveLength(4);
    expect(t.guard.sent[3]).toMatchObject({ tipo: 'hablar', agrupados: 4, prioridad: 'normal' });
    expect((t.ctx.db.prepare("SELECT COUNT(*) n FROM emergencies WHERE estado = 'entregado_agrupado'").get() as { n: number }).n).toBe(4);
  });

  it('una emergencia física después de una ráfaga llega al instante', async () => {
    const t = await setup();
    for (let i = 0; i < 5; i++) await t.send('hablar');
    expect(t.guard.sent).toHaveLength(3);
    await t.send('fisica');
    expect(t.guard.sent).toHaveLength(4);
    expect(t.guard.sent[3]).toMatchObject({ tipo: 'emergencia_fisica', prioridad: 'alta' });
    expect(t.guard.sent[3]!.agrupados).toBeUndefined();
  });

  it('el tope técnico devuelve 429 sin perder nada: la app lo reintenta', async () => {
    const t = await setup();
    const statuses = [];
    for (let i = 0; i < 32; i++) statuses.push((await t.send('hablar')).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });
});
