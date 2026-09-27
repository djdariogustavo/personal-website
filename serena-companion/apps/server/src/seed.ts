/**
 * Datos de ejemplo (brief §5): Matías R., operador de planta, "Mina Los Andes"
 * (ficticia), roster 14 × 14, hoy día 9 en turno noche. Incluye 28 días de
 * historial, tres dispositivos, un administrador, un kiosco y ocho compañeros
 * ficticios para que los reportes agregados superen el umbral de k-anonimato.
 *
 * Uso: npm run seed   (borra y recrea la base indicada en SERENA_DB_PATH)
 */
import { rmSync } from 'node:fs';
import { classify, DEFAULT_CONFIG, rosterStatus, type CheckIn, type MoodIndex, type SleepIndex } from '@serena/domain';
import { env } from './env.ts';
import { nextSeq, nowIso, openDb } from './db.ts';
import { hashSecret, newId, sha256, Vault } from './crypto.ts';

if (env.isProd) throw new Error('No se siembran datos de ejemplo en producción.');
for (const suffix of ['', '-wal', '-shm']) rmSync(env.dbPath + suffix, { force: true });
const db = openDb(env.dbPath);
const vault = new Vault(env.masterKey);
const now = new Date();

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number, h = 6, m = 12) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d;
};
const rnd = (i: number) => {
  const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
};

const orgId = newId();
db.prepare('INSERT INTO orgs (id, nombre, faena, pais, creado_en) VALUES (?, ?, ?, ?, ?)').run(orgId, 'Minera Los Andes S.A. (ficticia)', 'Mina Los Andes', 'AR', nowIso());

// Hoy es el día 9 del turno: el día 1 fue hace 8 días.
const rosterInicio = ymd(daysAgo(8));

function createUser(u: { nombre: string; corto: string; puesto: string; dni: string; usuario?: string; legajo: string; tel?: string; role?: 'worker' | 'admin'; password: string; pin?: string; qr?: string; inicio?: string; turno?: 'dia' | 'noche'; email?: string }) {
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, org_id, role, nombre, nombre_corto, puesto, dni, usuario, legajo, email, telefono, password_hash, kiosk_pin_hash, qr_token_hash, roster_inicio, turno, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    orgId,
    u.role ?? 'worker',
    u.nombre,
    u.corto,
    u.puesto,
    u.dni,
    u.usuario ?? null,
    u.legajo,
    u.email ?? null,
    u.tel ?? null,
    hashSecret(u.password),
    u.pin ? hashSecret(u.pin) : null,
    u.qr ? sha256(u.qr) : null,
    u.inicio ?? rosterInicio,
    u.turno ?? 'noche',
    nowIso(),
  );
  db.prepare('INSERT INTO consents (user_id, camara, animo, reaccion, chat, geo, otorgado, actualizado_en) VALUES (?, 1, 1, 1, 1, 1, 1, ?)').run(id, nowIso());
  return id;
}

const matias = createUser({
  nombre: 'Matías Rodríguez',
  corto: 'Matías',
  puesto: 'Operador de planta',
  dni: '30.456.789',
  usuario: 'mrodriguez',
  legajo: '04817',
  tel: '+54 9 264 555 0147',
  password: 'serena-demo',
  pin: '1234',
  qr: 'QR-DEMO-04817',
});

createUser({
  nombre: 'Laura Giménez',
  corto: 'Laura',
  puesto: 'Salud ocupacional · administración SERENA',
  dni: '28.111.222',
  usuario: 'admin',
  legajo: 'A0001',
  role: 'admin',
  password: 'serena-admin',
  email: 'admin@example.com',
  tel: '+54 9 264 555 0199',
});

function addDevice(userId: string, kind: string, nombre: string, sistema: string, efimero: boolean, ultima: Date) {
  const id = newId();
  db.prepare('INSERT INTO devices (id, user_id, kind, nombre, sistema, efimero, ultima_sync, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    userId,
    kind,
    nombre,
    sistema,
    efimero ? 1 : 0,
    ultima.toISOString(),
    daysAgo(40).toISOString(),
  );
  return id;
}
const phone = addDevice(matias, 'mobile', 'Teléfono de Matías', 'Android 14 · App', false, new Date(now.getTime() - 2 * 60_000));
const tablet = addDevice(matias, 'kiosk', 'Tablet comedor — Módulo 3', 'Kiosco · Android 12', true, daysAgo(0, 6, 14));
const laptop = addDevice(matias, 'desktop', 'Notebook casa', 'Web · Chrome', false, daysAgo(3, 21, 10));
db.prepare('UPDATE devices SET cerrado_en = NULL WHERE id = ?').run(tablet);

const devName: Record<string, [string, CheckIn['deviceKind']]> = {
  [phone]: ['Teléfono de Matías', 'mobile'],
  [tablet]: ['Tablet comedor — Módulo 3', 'kiosk'],
  [laptop]: ['Notebook casa', 'desktop'],
};

function insertCheckin(userId: string, deviceId: string, at: Date, c: Pick<CheckIn, 'animo' | 'sueno' | 'escaneo' | 'reaccion'>, inicio: string) {
  const st = rosterStatus({ inicio, diasTrabajo: 14, diasDescanso: 14 }, at);
  const nivel = classify(c, DEFAULT_CONFIG.niveles);
  const [deviceName, deviceKind] = devName[deviceId] ?? ['Teléfono', 'mobile'];
  const full: CheckIn = {
    id: newId(),
    userId,
    deviceId,
    deviceName,
    deviceKind,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    rosterDay: st.enTurno ? st.dia : null,
    onShift: st.enTurno,
    voz: null,
    nota: null,
    nivel,
    ...c,
  };
  db.prepare(
    `INSERT INTO checkins (id, user_id, org_id, device_id, creado_en, actualizado_en, nivel, en_turno, dia_roster, payload_enc, borrado, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(full.id, userId, orgId, deviceId, full.createdAt, full.updatedAt, nivel, st.enTurno ? 1 : 0, full.rosterDay, vault.encrypt(userId, full), nextSeq(db));
}

// 28 días de historial para Matías, coherentes con el roster (trabajo en los
// últimos 9 días, descanso 14 días antes, y el final del turno anterior).
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const recent = [1, 0, 1, 1, 0, 1, 0, 1, 1]; // 6 check-ins en los últimos 9 días
for (let i = 27; i >= 0; i--) {
  const at = daysAgo(i, i === 0 ? 6 : 5 + Math.floor(rnd(i) * 3), i === 0 ? 12 : Math.floor(rnd(i + 3) * 59));
  const st = rosterStatus({ inicio: rosterInicio, diasTrabajo: 14, diasDescanso: 14 }, at);
  const idx = 27 - i;
  const checked = idx >= 19 ? recent[idx - 19] === 1 : st.enTurno ? rnd(idx) > 0.3 : rnd(idx) > 0.72;
  if (!checked) continue;
  const n = rnd(idx + 50) - 0.5;
  const dn = st.dia;
  const estres = i === 0 ? 3.1 : st.enTurno ? clamp(1.6 + 0.17 * dn + n * 0.5, 1, 4.1) : 1.5 + rnd(idx + 9) * 0.5;
  const hrv = i === 0 ? 42 : st.enTurno ? 62 - 2.2 * dn + n * 6 : 63 + n * 6;
  const animo = (st.enTurno ? clamp(Math.round(0.22 * dn + n), 0, 3) : clamp(Math.round(n), 0, 1)) as MoodIndex;
  const sueno = (st.enTurno ? clamp(Math.round(2.2 - 0.12 * dn + n), 0, 3) : 2) as SleepIndex;
  const deviceId = st.enTurno ? (rnd(idx + 7) > 0.5 ? tablet : phone) : laptop;
  insertCheckin(
    matias,
    deviceId,
    at,
    {
      animo: i === 0 ? 3 : animo,
      sueno: i === 0 ? 1 : sueno,
      escaneo: {
        metricas: {
          pulso: Math.round(i === 0 ? 78 : 66 + estres * 3 + n * 4),
          hrv: Math.round(hrv),
          respiracion: Math.round(i === 0 ? 15 : 12 + estres),
          estres: Math.round(estres * 10) / 10,
        },
        calidad: 0.9,
        duracionS: 45,
      },
      reaccion: { toques: 10, mediaMs: Math.round(i === 0 ? 312 : 280 + estres * 12), anticipados: 0 },
    },
    rosterInicio,
  );
}

// Conversación de ejemplo (6.10).
const chat: Array<['user' | 'companion', string]> = [
  ['user', 'Estoy en el día 9 y ya no doy más, extraño a mis hijos.'],
  ['companion', 'Te entiendo, Matías. Nueve días lejos pesan, y más con turno noche. Extrañar a tus hijos habla de lo mucho que te importan. ¿Pudiste hablar con ellos en estos días?'],
  ['user', 'Poco, la señal es mala.'],
  ['companion', 'Qué bronca, eso lo hace más difícil. Si querés, podemos pensar juntos un momento del día para intentarlo, o podés grabarles un audio ahora para mandarlo cuando haya señal. ¿Qué te parece?'],
];
chat.forEach(([role, text], i) => {
  const at = daysAgo(1, 23, 31 + i);
  db.prepare('INSERT INTO chat_messages (id, user_id, role, content_enc, creado_en) VALUES (?, ?, ?, ?, ?)').run(newId(), matias, role, vault.encrypt(matias, text), at.toISOString());
});

// Compañeros ficticios (solo para reportes agregados).
for (let w = 0; w < 8; w++) {
  const inicio = ymd(daysAgo(8 + (w % 3)));
  const id = createUser({
    nombre: `Trabajador Demo ${w + 1}`,
    corto: `Demo ${w + 1}`,
    puesto: 'Operador',
    dni: `40.000.00${w}`,
    legajo: `09${w}00`,
    password: newId(),
  });
  const dev = addDevice(id, 'mobile', 'Teléfono', 'Android', false, now);
  for (let i = 27; i >= 0; i--) {
    if (rnd(w * 100 + i) < 0.45) continue;
    const at = daysAgo(i, 6, 0);
    const st = rosterStatus({ inicio, diasTrabajo: 14, diasDescanso: 14 }, at);
    const e = st.enTurno ? clamp(1.5 + 0.16 * st.dia + (rnd(w * 7 + i) - 0.5), 1, 4.6) : 1.6;
    insertCheckin(
      id,
      dev,
      at,
      {
        animo: clamp(Math.round(e - 1.2), 0, 4) as MoodIndex,
        sueno: 2,
        escaneo: { metricas: { pulso: 70, hrv: 55, respiracion: 14, estres: Math.round(e * 10) / 10 }, calidad: 0.9, duracionS: 45 },
        reaccion: null,
      },
      inicio,
    );
  }
}

// Kiosco registrado.
const kioskToken = 'kiosco-demo-comedor-modulo-3-token-no-usar-en-produccion';
db.prepare('INSERT INTO kiosks (id, org_id, nombre, token_hash, creado_en) VALUES (?, ?, ?, ?, ?)').run(newId(), orgId, 'Tablet comedor — Módulo 3', sha256(kioskToken), nowIso());

console.info(`
[serena] Datos de ejemplo creados en ${env.dbPath}

  Trabajador     DNI 30.456.789 (o usuario "mrodriguez") · contraseña "serena-demo"
                 Kiosco: legajo 04817 · PIN 1234 · QR "QR-DEMO-04817"
  Administración usuario "admin" · contraseña "serena-admin"
  Kiosco         token: ${kioskToken}
  2FA            en desarrollo el código se imprime en la consola del servidor.
`);
