import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { Vault } from '../src/crypto.ts';
import { addUser, login, makeCtx } from './helpers.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('cifrado en reposo (AES-256-GCM por persona)', () => {
  const vault = new Vault(randomBytes(32).toString('base64'));

  it('cada cifrado usa un IV nuevo: el mismo dato no produce el mismo texto', () => {
    expect(vault.encrypt('u1', { a: 1 })).not.toBe(vault.encrypt('u1', { a: 1 }));
  });

  it('un texto cifrado de una persona no se puede descifrar como si fuera de otra', () => {
    const blob = vault.encrypt('u1', { nota: 'privado' });
    expect(vault.decrypt('u1', blob)).toEqual({ nota: 'privado' });
    expect(() => vault.decrypt('u2', blob)).toThrow();
  });

  it('cualquier alteración del texto cifrado se detecta', () => {
    const [v, iv, ct, tag] = vault.encrypt('u1', { x: 'dato' }).split('.');
    const b = Buffer.from(ct!, 'base64');
    b[0] = b[0]! ^ 1;
    expect(() => vault.decrypt('u1', [v, iv, b.toString('base64'), tag].join('.'))).toThrow();
  });

  it('otra clave maestra no descifra nada', () => {
    const otra = new Vault(randomBytes(32).toString('base64'));
    expect(() => otra.decrypt('u1', vault.encrypt('u1', 1))).toThrow();
  });

  it('la ubicación del pedido de ayuda se guarda cifrada', async () => {
    const { ctx, app, orgId, messenger } = makeCtx();
    addUser(ctx, orgId, { dni: '30111222', legajo: '1', password: 'p' });
    const s = await login(app, messenger, '30111222', 'p');
    await request(app)
      .post('/api/emergency')
      .set(bearer(s.token))
      .send({ id: crypto.randomUUID(), tipo: 'fisica', compartirUbicacion: true, ubicacion: { lat: -31.5372, lng: -68.5251, precisionM: 12 }, creadoEn: new Date().toISOString(), origen: 'boton' });
    const row = ctx.db.prepare('SELECT ubicacion_enc FROM emergencies').get() as { ubicacion_enc: string };
    expect(row.ubicacion_enc.startsWith('v1.')).toBe(true);
    expect(row.ubicacion_enc).not.toMatch(/31\.53|68\.52/);
  });
});
