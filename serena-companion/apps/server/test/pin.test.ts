import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { isWeakPin, newPin, sha256 } from '../src/crypto.ts';
import { addUser, login, makeCtx } from './helpers.ts';

describe('PIN del kiosco', () => {
  it('reconoce los PIN fáciles de adivinar', () => {
    for (const p of ['0000', '1111', '1234', '4321', '0123', '6789', '9876', '1212', '1221', '7007']) expect([p, isWeakPin(p)]).toEqual([p, true]);
    for (const p of ['4817', '0592', '2803', '9160']) expect([p, isWeakPin(p)]).toEqual([p, false]);
  });

  it('genera PIN de 4 dígitos, nunca débiles, incluyendo ceros a la izquierda', () => {
    const pins = Array.from({ length: 3000 }, () => newPin());
    expect(pins.every((p) => /^\d{4}$/.test(p) && !isWeakPin(p))).toBe(true);
    expect(pins.some((p) => p.startsWith('0'))).toBe(true);
    // Distribución razonable: con 3000 muestras sobre ~9900 valores válidos deberían repetirse pocos.
    expect(new Set(pins).size).toBeGreaterThan(2400);
  });

  it('el alta de trabajador entrega un PIN que no es débil', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { role: 'admin', dni: '1010101', usuario: 'adm', legajo: 'A', password: 'p' });
    const s = await login(app, messenger, 'adm', 'p', 'desktop');
    const r = await request(app)
      .post('/api/admin/workers')
      .set({ authorization: `Bearer ${s.token}` })
      .send({ nombre: 'Persona Nueva', nombreCorto: 'Persona', dni: '33.222.111', legajo: '5555', rosterInicio: '2026-09-01' });
    expect(r.status).toBe(201);
    expect(isWeakPin(r.body.credenciales.pinKiosco)).toBe(false);
  });

  it('bloquea el legajo tras 5 PIN incorrectos, en cualquier kiosco, y el QR sigue funcionando', async () => {
    const { ctx, app, orgId } = makeCtx();
    addUser(ctx, orgId, { dni: '2020202', legajo: '888', password: 'p', pin: '4817', qr: 'QR-888' });
    const t1 = 'kiosk-token-uno-para-pruebas-0123456789';
    const t2 = 'kiosk-token-dos-para-pruebas-0123456789';
    const now = new Date().toISOString();
    ctx.db.prepare("INSERT INTO kiosks (id, org_id, nombre, token_hash, creado_en) VALUES ('k1', ?, 'Comedor', ?, ?)").run(orgId, sha256(t1), now);
    ctx.db.prepare("INSERT INTO kiosks (id, org_id, nombre, token_hash, creado_en) VALUES ('k2', ?, 'Acceso', ?, ?)").run(orgId, sha256(t2), now);
    const tryPin = (kioskToken: string, pin: string) => request(app).post('/api/auth/kiosk').send({ kioskToken, legajo: '888', pin });

    // 3 intentos en un kiosco y 2 en otro: el bloqueo es por persona.
    for (const k of [t1, t1, t1, t2, t2]) expect((await tryPin(k, '0000')).status).toBe(401);
    const locked = await tryPin(t1, '4817');
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('pin_bloqueado');
    expect((await tryPin(t2, '4817')).status).toBe(429);
    // El QR (credencial física) no queda bloqueado.
    expect((await request(app).post('/api/auth/kiosk').send({ kioskToken: t2, qr: 'QR-888' })).status).toBe(200);

    // Vencido el bloqueo, el PIN correcto entra y el contador vuelve a cero.
    ctx.db.prepare("UPDATE users SET kiosk_bloqueo_hasta = '2000-01-01T00:00:00Z' WHERE legajo = '888'").run();
    expect((await tryPin(t1, '4817')).status).toBe(200);
    const row = ctx.db.prepare("SELECT kiosk_fallos FROM users WHERE legajo = '888'").get() as { kiosk_fallos: number };
    expect(row.kiosk_fallos).toBe(0);
  });

  it('la base existente se actualiza sin perder datos', async () => {
    const { openDb } = await import('../src/db.ts');
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const path = join(mkdtempSync(join(tmpdir(), 'serena-')), 'v1.db');
    // Base en versión 1 con una persona cargada.
    const db1 = openDb(path);
    db1.exec("UPDATE schema_version SET v = 1; ALTER TABLE users DROP COLUMN kiosk_bloqueo_hasta; ALTER TABLE users DROP COLUMN kiosk_fallos;");
    db1.prepare("INSERT INTO orgs (id, nombre, faena, pais, creado_en) VALUES ('o', 'O', 'F', 'AR', 'x')").run();
    db1.prepare("INSERT INTO users (id, org_id, role, nombre, nombre_corto, password_hash, roster_inicio, creado_en) VALUES ('u', 'o', 'worker', 'N', 'N', 'h', '2026-09-01', 'x')").run();
    db1.close();
    const db2 = openDb(path);
    expect((db2.prepare('SELECT v FROM schema_version').get() as { v: number }).v).toBe(2);
    expect(db2.prepare("SELECT kiosk_fallos, nombre FROM users WHERE id = 'u'").get()).toEqual({ kiosk_fallos: 0, nombre: 'N' });
  });
});
