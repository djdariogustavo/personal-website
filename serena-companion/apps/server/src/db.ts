import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Persistencia en SQLite (node:sqlite). Los datos individuales sensibles
 * (check-ins, conversaciones, ubicación) se guardan cifrados con la clave del
 * usuario (ver crypto.ts). En claro solo queda lo mínimo para operar:
 * identidad, fechas, nivel (para escalamiento y agregados anónimos) y estado
 * de sincronización.
 */

const MIGRATIONS: string[] = [
  `
  CREATE TABLE orgs (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    faena TEXT NOT NULL,
    pais TEXT NOT NULL CHECK (pais IN ('AR','CL')),
    creado_en TEXT NOT NULL
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    role TEXT NOT NULL CHECK (role IN ('worker','admin')),
    nombre TEXT NOT NULL,
    nombre_corto TEXT NOT NULL,
    puesto TEXT NOT NULL DEFAULT '',
    dni TEXT UNIQUE,
    usuario TEXT UNIQUE,
    legajo TEXT,
    email TEXT,
    telefono TEXT,
    password_hash TEXT NOT NULL,
    kiosk_pin_hash TEXT,
    qr_token_hash TEXT UNIQUE,
    roster_inicio TEXT NOT NULL,
    roster_trabajo INTEGER NOT NULL DEFAULT 14,
    roster_descanso INTEGER NOT NULL DEFAULT 14,
    turno TEXT NOT NULL DEFAULT 'noche' CHECK (turno IN ('dia','noche')),
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL,
    UNIQUE (org_id, legajo)
  );

  CREATE TABLE consents (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    camara INTEGER NOT NULL,
    animo INTEGER NOT NULL,
    reaccion INTEGER NOT NULL,
    chat INTEGER NOT NULL,
    geo INTEGER NOT NULL,
    otorgado INTEGER NOT NULL DEFAULT 1,
    actualizado_en TEXT NOT NULL,
    device_id TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    nombre TEXT NOT NULL,
    sistema TEXT NOT NULL,
    efimero INTEGER NOT NULL DEFAULT 0,
    trust_hash TEXT,
    trust_hasta TEXT,
    ultima_sync TEXT,
    creado_en TEXT NOT NULL,
    cerrado_en TEXT
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    creada_en TEXT NOT NULL,
    vence_en TEXT NOT NULL,
    ultimo_uso TEXT NOT NULL,
    inactividad_s INTEGER NOT NULL,
    revocada_en TEXT
  );

  CREATE TABLE login_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0,
    device_kind TEXT NOT NULL,
    device_nombre TEXT NOT NULL,
    device_sistema TEXT NOT NULL,
    vence_en TEXT NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE kiosks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    nombre TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    creado_en TEXT NOT NULL,
    revocado_en TEXT
  );

  CREATE TABLE checkins (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    creado_en TEXT NOT NULL,
    actualizado_en TEXT NOT NULL,
    nivel TEXT NOT NULL,
    en_turno INTEGER NOT NULL,
    dia_roster INTEGER,
    payload_enc TEXT,
    borrado INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL
  );
  CREATE INDEX checkins_user_seq ON checkins(user_id, seq);
  CREATE INDEX checkins_org_fecha ON checkins(org_id, creado_en);

  CREATE TABLE sync_mutations (
    mutation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    aplicada_en TEXT NOT NULL
  );

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','companion')),
    content_enc TEXT NOT NULL,
    creado_en TEXT NOT NULL,
    riesgo TEXT NOT NULL DEFAULT 'ninguno'
  );
  CREATE INDEX chat_user ON chat_messages(user_id, creado_en);

  CREATE TABLE emergencies (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    origen TEXT NOT NULL,
    ubicacion_enc TEXT,
    creado_cliente TEXT NOT NULL,
    recibido_en TEXT NOT NULL,
    canal TEXT NOT NULL,
    estado TEXT NOT NULL
  );

  -- Registro de auditoría de escalamientos y accesos a datos individuales.
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT,
    actor TEXT NOT NULL,
    accion TEXT NOT NULL,
    comparte_datos INTEGER NOT NULL DEFAULT 0,
    detalle TEXT,
    creado_en TEXT NOT NULL
  );
  CREATE INDEX audit_user ON audit_log(user_id, creado_en);

  -- Pagos: aislados de los datos individuales.
  CREATE TABLE subscriptions (
    org_id TEXT PRIMARY KEY REFERENCES orgs(id),
    proveedor TEXT,
    plan_id TEXT,
    estado TEXT NOT NULL DEFAULT 'sin_suscripcion',
    puestos INTEGER NOT NULL DEFAULT 0,
    moneda TEXT,
    externo_cliente TEXT,
    externo_suscripcion TEXT,
    proximo_cobro TEXT,
    cancelada_al_final INTEGER NOT NULL DEFAULT 0,
    actualizada_en TEXT
  );

  CREATE TABLE payment_events (
    proveedor TEXT NOT NULL,
    evento_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    org_id TEXT,
    recibido_en TEXT NOT NULL,
    PRIMARY KEY (proveedor, evento_id)
  );

  CREATE TABLE checkout_sessions (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    proveedor TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    puestos INTEGER NOT NULL,
    moneda TEXT NOT NULL,
    externo_id TEXT,
    estado TEXT NOT NULL,
    creado_en TEXT NOT NULL
  );

  CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  INSERT INTO meta (k, v) VALUES ('seq', '0');
  `,
];

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      v++;
      db.prepare('UPDATE schema_version SET v = ?').run(v);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

/** Secuencia global monótona para el cursor de sincronización. */
export function nextSeq(db: DB): number {
  const r = db.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'seq' RETURNING v").get() as { v: string };
  return Number(r.v);
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();
