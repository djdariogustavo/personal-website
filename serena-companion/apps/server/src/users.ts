import type { Consents, UserProfile } from '@serena/domain';
import { DEFAULT_CONSENTS } from '@serena/domain';
import type { DB } from './db.ts';
import { HttpError } from './auth.ts';

export interface UserRow {
  id: string;
  org_id: string;
  role: 'worker' | 'admin';
  nombre: string;
  nombre_corto: string;
  puesto: string;
  dni: string | null;
  usuario: string | null;
  legajo: string | null;
  email: string | null;
  telefono: string | null;
  password_hash: string;
  kiosk_pin_hash: string | null;
  roster_inicio: string;
  roster_trabajo: number;
  roster_descanso: number;
  turno: 'dia' | 'noche';
  activo: number;
  baja_en: string | null;
  purga_en: string | null;
}

export interface OrgRow {
  id: string;
  nombre: string;
  faena: string;
  pais: 'AR' | 'CL';
}

export function getUser(db: DB, id: string): UserRow {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!u) throw new HttpError(404, 'usuario_inexistente');
  return u;
}

export function getOrg(db: DB, id: string): OrgRow {
  return db.prepare('SELECT id, nombre, faena, pais FROM orgs WHERE id = ?').get(id) as unknown as OrgRow;
}

export function getConsents(db: DB, userId: string): Consents & { otorgado: boolean } {
  const c = db.prepare('SELECT * FROM consents WHERE user_id = ?').get(userId) as
    | { camara: number; animo: number; reaccion: number; chat: number; geo: number; otorgado: number }
    | undefined;
  if (!c) return { ...DEFAULT_CONSENTS, otorgado: false };
  return {
    camara: !!c.camara,
    animo: !!c.animo,
    reaccion: !!c.reaccion,
    chat: !!c.chat,
    geo: !!c.geo,
    otorgado: !!c.otorgado,
  };
}

export function initials(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function profile(db: DB, userId: string): UserProfile & { consentimientoOtorgado: boolean } {
  const u = getUser(db, userId);
  const o = getOrg(db, u.org_id);
  const { otorgado, ...consents } = getConsents(db, userId);
  return {
    id: u.id,
    nombre: u.nombre,
    nombreCorto: u.nombre_corto,
    iniciales: initials(u.nombre),
    puesto: u.puesto,
    role: u.role,
    org: { id: o.id, nombre: o.nombre, faena: o.faena, pais: o.pais },
    roster: { inicio: u.roster_inicio, diasTrabajo: u.roster_trabajo, diasDescanso: u.roster_descanso, turno: u.turno },
    consents,
    consentimientoOtorgado: otorgado,
    baja: !u.activo && u.baja_en && u.purga_en ? { desde: u.baja_en, purgaEn: u.purga_en } : null,
  };
}
