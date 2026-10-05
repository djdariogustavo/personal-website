import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { altaInicial } from '../src/alta.ts';
import { login, makeCtx } from './helpers.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const DATOS = {
  organizacion: 'Velasco Group SRL',
  faena: 'Piloto',
  pais: 'AR' as const,
  nombre: 'Persona Administradora',
  usuario: 'gadmin',
  telefono: '+54 9 351 202-3790',
};

describe('alta inicial en producción', () => {
  it('crea la organización y un administrador con contraseña temporal que obliga a cambiarla', async () => {
    const { ctx, app, messenger } = makeCtx();
    const r = altaInicial(ctx.db, DATOS);
    expect(r.passwordInicial.length).toBeGreaterThanOrEqual(16);
    const u = ctx.db.prepare('SELECT org_id, role, telefono, password_temporal FROM users WHERE id = ?').get(r.adminId);
    expect(u).toEqual({ org_id: r.orgId, role: 'admin', telefono: '+5493512023790', password_temporal: 1 });

    const s = await login(app, messenger, 'gadmin', r.passwordInicial, 'desktop');
    expect(s.perfil).toMatchObject({ debeCambiarPassword: true });
    const c = await request(app).post('/api/me/password').set(bearer(s.token)).send({ actual: r.passwordInicial, nueva: 'mate cocido en la garita' });
    expect(c.status).toBe(200);
    expect(c.body.perfil.debeCambiarPassword).toBe(false);
  });

  it('rechaza un teléfono sin formato internacional y un usuario repetido, sin dejar datos a medias', () => {
    const { ctx } = makeCtx();
    const orgsAntes = (ctx.db.prepare('SELECT count(*) AS n FROM orgs').get() as { n: number }).n;
    expect(() => altaInicial(ctx.db, { ...DATOS, telefono: '351 202 3790' })).toThrow(/formato internacional/);
    altaInicial(ctx.db, DATOS);
    expect(() => altaInicial(ctx.db, DATOS)).toThrow(/Ya existe/);
    expect((ctx.db.prepare('SELECT count(*) AS n FROM orgs').get() as { n: number }).n).toBe(orgsAntes + 1);
  });
});
