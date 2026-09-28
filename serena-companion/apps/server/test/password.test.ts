import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { addUser, login, makeCtx } from './helpers.ts';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const FUERTE = 'mate cocido en la garita';

async function base() {
  const env = makeCtx();
  const workerId = addUser(env.ctx, env.orgId, { dni: '30111222', legajo: '777', password: 'vieja-contrasena-larga' });
  addUser(env.ctx, env.orgId, { role: 'admin', dni: '9999999', usuario: 'admin', legajo: 'A1', password: 'p' });
  return { ...env, workerId };
}

describe('cambio de contraseña', () => {
  it('exige la actual y la política, y cierra las demás sesiones', async () => {
    const { app, messenger } = await base();
    const a = await login(app, messenger, '30111222', 'vieja-contrasena-larga');
    const b = await login(app, messenger, '30111222', 'vieja-contrasena-larga', 'desktop');
    const mal = await request(app).post('/api/me/password').set(bearer(a.token)).send({ actual: 'otra', nueva: FUERTE });
    expect(mal.status).toBe(401);
    const debil = await request(app).post('/api/me/password').set(bearer(a.token)).send({ actual: 'vieja-contrasena-larga', nueva: '30111222abc' });
    expect(debil.status).toBe(400);
    expect(debil.body.error).toBe('password_debil');
    const ok = await request(app).post('/api/me/password').set(bearer(a.token)).send({ actual: 'vieja-contrasena-larga', nueva: FUERTE });
    expect(ok.status).toBe(200);
    expect(ok.body.sesionesCerradas).toBe(1);
    expect((await request(app).get('/api/me').set(bearer(a.token))).status).toBe(200);
    expect((await request(app).get('/api/me').set(bearer(b.token))).status).toBe(401);
    expect(messenger.avisos.at(-1)).toMatch(/se cambió la contraseña/);
    await expect(login(app, messenger, '30111222', 'vieja-contrasena-larga')).rejects.toThrow();
    await login(app, messenger, '30111222', FUERTE);
  });
});

describe('recuperación por SMS', () => {
  it('la respuesta es la misma exista o no la cuenta', async () => {
    const { app, messenger } = await base();
    messenger.last = null;
    const no = await request(app).post('/api/auth/recover/start').send({ identificador: '12345678' });
    expect(messenger.last).toBeNull();
    const si = await request(app).post('/api/auth/recover/start').send({ identificador: '30.111.222' });
    expect(messenger.lastProposito).toBe('recuperacion');
    expect(no.status).toBe(si.status);
    expect(Object.keys(no.body).sort()).toEqual(Object.keys(si.body).sort());
    // Un desafío sin cuenta falla igual que un código incorrecto.
    const f = await request(app).post('/api/auth/recover/finish').send({ challengeId: no.body.challengeId, codigo: '123456', nueva: FUERTE });
    expect(f.body.error).toBe('codigo_incorrecto');
  });

  it('con el código correcto cambia la contraseña y cierra todas las sesiones', async () => {
    const { app, messenger, ctx, workerId } = await base();
    const s = await login(app, messenger, '30111222', 'vieja-contrasena-larga');
    const st = await request(app).post('/api/auth/recover/start').send({ identificador: '30111222' });
    const code = messenger.last!;
    const debil = await request(app).post('/api/auth/recover/finish').send({ challengeId: st.body.challengeId, codigo: code, nueva: 'password123' });
    expect(debil.body.error).toBe('password_debil');
    // El código sigue valiendo después de una contraseña rechazada.
    const ok = await request(app).post('/api/auth/recover/finish').send({ challengeId: st.body.challengeId, codigo: code, nueva: FUERTE });
    expect(ok.status).toBe(200);
    expect((await request(app).get('/api/me').set(bearer(s.token))).status).toBe(401);
    const reuso = await request(app).post('/api/auth/recover/finish').send({ challengeId: st.body.challengeId, codigo: code, nueva: 'otra frase bien larga' });
    expect(reuso.body.error).toBe('codigo_vencido');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ? AND accion = 'password_restablecida_sms'").get(workerId)).toEqual({ n: 1 });
    await login(app, messenger, '30111222', FUERTE);
  });

  it('bloquea el código después de 5 intentos', async () => {
    const { app, messenger } = await base();
    const st = await request(app).post('/api/auth/recover/start').send({ identificador: '30111222' });
    const code = messenger.last!;
    const otro = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/recover/finish').send({ challengeId: st.body.challengeId, codigo: otro, nueva: FUERTE });
    const r = await request(app).post('/api/auth/recover/finish').send({ challengeId: st.body.challengeId, codigo: code, nueva: FUERTE });
    expect(r.body.error).toBe('codigo_vencido');
  });
});

describe('restablecimiento por la empresa', () => {
  it('entrega una temporal que obliga a cambiarla; mientras tanto solo se puede pedir ayuda', async () => {
    const { app, messenger, workerId } = await base();
    const admin = await login(app, messenger, 'admin', 'p', 'desktop');
    const viejo = await login(app, messenger, '30111222', 'vieja-contrasena-larga');
    const r = await request(app).post(`/api/admin/workers/${workerId}/password`).set(bearer(admin.token));
    expect(r.status).toBe(200);
    expect((await request(app).get('/api/me').set(bearer(viejo.token))).status).toBe(401);
    expect(messenger.avisos.at(-1)).toMatch(/tu empresa restableció/);

    const s = await login(app, messenger, '30111222', r.body.passwordTemporal);
    expect(s.perfil).toMatchObject({ debeCambiarPassword: true });
    const bloqueado = await request(app).get('/api/sync/pull').set(bearer(s.token));
    expect(bloqueado.body.error).toBe('debe_cambiar_password');
    const ayuda = await request(app)
      .post('/api/emergency')
      .set(bearer(s.token))
      .send({ id: crypto.randomUUID(), tipo: 'hablar', compartirUbicacion: false, creadoEn: new Date().toISOString(), origen: 'boton' });
    expect(ayuda.status).toBe(200);

    const c = await request(app).post('/api/me/password').set(bearer(s.token)).send({ actual: r.body.passwordTemporal, nueva: FUERTE });
    expect(c.body.perfil.debeCambiarPassword).toBe(false);
    expect((await request(app).get('/api/sync/pull').set(bearer(s.token))).status).toBe(200);
  });

  it('una persona dada de alta por la empresa debe cambiar la contraseña inicial', async () => {
    const { app, messenger } = await base();
    const admin = await login(app, messenger, 'admin', 'p', 'desktop');
    const alta = await request(app)
      .post('/api/admin/workers')
      .set(bearer(admin.token))
      .send({ nombre: 'Ana Paz', nombreCorto: 'Ana', dni: '28.000.111', legajo: '900', telefono: '+5491100000000', rosterInicio: '2026-09-01' });
    const s = await login(app, messenger, '28000111', alta.body.credenciales.passwordInicial);
    expect(s.perfil).toMatchObject({ debeCambiarPassword: true });
  });

  it('solo un administrador de la misma empresa puede restablecer', async () => {
    const a = await base();
    const b = await base();
    const w = await login(a.app, a.messenger, '30111222', 'vieja-contrasena-larga');
    expect((await request(a.app).post(`/api/admin/workers/${a.workerId}/password`).set(bearer(w.token))).status).toBe(403);
    const adminA = await login(a.app, a.messenger, 'admin', 'p', 'desktop');
    expect((await request(a.app).post(`/api/admin/workers/${b.workerId}/password`).set(bearer(adminA.token))).status).toBe(404);
  });
});
