import type { DB } from './db.ts';
import { nowIso } from './db.ts';
import { hashSecret, newId, newToken } from './crypto.ts';
import { aE164 } from './sms/twilio.ts';

/**
 * Alta inicial de una organización y su primera cuenta de administración, para un servidor en producción
 * (allí no se siembran datos de ejemplo). La contraseña es aleatoria, se muestra una sola vez y es temporal:
 * hay que cambiarla en el primer ingreso. El segundo factor llega por SMS al teléfono indicado.
 * Desde el panel, esa cuenta da de alta al resto del equipo.
 */
export interface DatosAlta {
  organizacion: string;
  faena: string;
  pais: 'AR' | 'CL';
  nombre: string;
  usuario: string;
  telefono: string;
  email?: string | null;
}

export function altaInicial(db: DB, d: DatosAlta): { orgId: string; adminId: string; passwordInicial: string } {
  const telefono = aE164(d.telefono);
  if (!telefono) throw new Error('El teléfono debe estar en formato internacional, p. ej. +5493512023790.');
  if (!/^[a-z0-9._-]{3,40}$/.test(d.usuario)) throw new Error('El usuario admite minúsculas, números, punto, guion y guion bajo (3 a 40).');
  if (d.organizacion.trim().length < 2 || d.faena.trim().length < 2 || d.nombre.trim().length < 3)
    throw new Error('Faltan la organización, la faena o el nombre de la persona.');
  if (db.prepare('SELECT 1 FROM users WHERE lower(usuario) = ?').get(d.usuario))
    throw new Error(`Ya existe una cuenta con el usuario ${d.usuario}.`);

  const orgId = newId();
  const adminId = newId();
  const passwordInicial = newToken(12);
  const ahora = nowIso();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO orgs (id, nombre, faena, pais, creado_en) VALUES (?, ?, ?, ?, ?)').run(orgId, d.organizacion.trim(), d.faena.trim(), d.pais, ahora);
    db.prepare(
      `INSERT INTO users (id, org_id, role, nombre, nombre_corto, puesto, usuario, legajo, email, telefono, password_hash,
        roster_inicio, turno, creado_en, password_temporal)
       VALUES (?, ?, 'admin', ?, ?, 'Administración SERENA', ?, ?, ?, ?, ?, ?, 'dia', ?, 1)`,
    ).run(
      adminId,
      orgId,
      d.nombre.trim(),
      d.nombre.trim().split(/\s+/)[0]!,
      d.usuario,
      'A0001',
      d.email ?? null,
      telefono,
      hashSecret(passwordInicial),
      ahora.slice(0, 10),
      ahora,
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { orgId, adminId, passwordInicial };
}
