/**
 * API simulada para la vista previa (modo demo). Replica en el navegador los
 * contratos de apps/server con los datos de ejemplo del brief. No hay red, no
 * se guarda nada fuera del navegador y no hay cobros ni avisos reales.
 */
import {
  applyConsents,
  classify,
  DEFAULT_CONFIG,
  DEFAULT_CONSENTS,
  detectRisk,
  K_CELDA,
  K_GRUPO,
  publicarDistribucion,
  rosterStatus,
  ventanaReporte,
  type CheckIn,
  type Consents,
  type DeviceInfo,
  type MoodIndex,
  type SleepIndex,
  type SubscriptionSummary,
  type SyncMutation,
} from '@serena/domain';

class MockError extends Error {
  constructor(
    public status: number,
    public code: string,
    public mensaje = '',
  ) {
    super(code);
  }
}
export { MockError };

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number, h = 6, m = 12) => {
  const d = now();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d;
};
const rnd = (i: number) => {
  const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const uid = () => crypto.randomUUID();

// ---------- Estado de la demo ----------

const ORG = { id: 'org-demo', nombre: 'Minera Los Andes S.A. (ficticia)', faena: 'Mina Los Andes', pais: 'AR' as const };
const ROSTER = { inicio: ymd(daysAgo(8)), diasTrabajo: 14, diasDescanso: 14, turno: 'noche' as const };

const USERS = {
  worker: { id: 'u-matias', nombre: 'Matías Rodríguez', nombreCorto: 'Matías', iniciales: 'MR', puesto: 'Operador de planta', role: 'worker' as const },
  admin: { id: 'u-admin', nombre: 'Administración SERENA', nombreCorto: 'Administración', iniciales: 'AS', puesto: 'Salud ocupacional · Mina Los Andes', role: 'admin' as const },
};

const DEV = {
  phone: { id: 'd-phone', kind: 'mobile' as const, nombre: 'Teléfono de Matías', sistema: 'Android 14 · App' },
  tablet: { id: 'd-tablet', kind: 'kiosk' as const, nombre: 'Tablet comedor — Módulo 3', sistema: 'Kiosco · Android 12' },
  laptop: { id: 'd-laptop', kind: 'desktop' as const, nombre: 'Notebook casa', sistema: 'Web · Chrome' },
};

interface State {
  consents: Consents;
  otorgado: boolean;
  checkins: Map<string, { c: CheckIn; seq: number; deleted: boolean }>;
  seq: number;
  chat: Array<{ id: string; role: 'user' | 'companion'; text: string; createdAt: string; riesgo: string }>;
  shared: number;
  devices: Array<DeviceInfo & { ultimaSyncIso: string | null }>;
  challenge: { id: string; code: string; who: 'worker' | 'admin' } | null;
  sub: SubscriptionSummary & { checkout?: { id: string; planId: string; puestos: number; moneda: string } };
  kiosks: Array<{ id: string; nombre: string; creado_en: string; revocado_en: string | null }>;
  seenMutations: Set<string>;
}

function seedCheckins(): State['checkins'] {
  const map: State['checkins'] = new Map();
  const recent = [1, 0, 1, 1, 0, 1, 0, 1, 1];
  let seq = 0;
  for (let i = 27; i >= 0; i--) {
    const at = daysAgo(i, i === 0 ? 6 : 5 + Math.floor(rnd(i) * 3), i === 0 ? 12 : Math.floor(rnd(i + 3) * 59));
    const st = rosterStatus(ROSTER, at);
    const idx = 27 - i;
    const checked = idx >= 19 ? recent[idx - 19] === 1 : st.enTurno ? rnd(idx) > 0.3 : rnd(idx) > 0.72;
    if (!checked) continue;
    const n = rnd(idx + 50) - 0.5;
    const dn = st.dia;
    const estres = i === 0 ? 3.1 : st.enTurno ? clamp(1.6 + 0.17 * dn + n * 0.5, 1, 4.1) : 1.5 + rnd(idx + 9) * 0.5;
    const hrv = i === 0 ? 42 : st.enTurno ? 62 - 2.2 * dn + n * 6 : 63 + n * 6;
    const dev = i === 0 ? DEV.tablet : st.enTurno ? (rnd(idx + 7) > 0.5 ? DEV.tablet : DEV.phone) : DEV.laptop;
    const c: CheckIn = {
      id: `seed-${idx}`,
      userId: USERS.worker.id,
      deviceId: dev.id,
      deviceName: dev.nombre,
      deviceKind: dev.kind,
      createdAt: iso(at),
      updatedAt: iso(at),
      rosterDay: st.enTurno ? st.dia : null,
      onShift: st.enTurno,
      animo: (i === 0 ? 3 : st.enTurno ? clamp(Math.round(0.22 * dn + n), 0, 3) : clamp(Math.round(n), 0, 1)) as MoodIndex,
      sueno: (i === 0 ? 1 : st.enTurno ? clamp(Math.round(2.2 - 0.12 * dn + n), 0, 3) : 2) as SleepIndex,
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
      voz: null,
      nivel: 'bajo',
      nota: null,
    };
    c.nivel = classify(c, DEFAULT_CONFIG.niveles);
    map.set(c.id, { c, seq: ++seq, deleted: false });
  }
  return map;
}

function freshState(): State {
  const checkins = seedCheckins();
  const y = daysAgo(1, 23, 31);
  const chat: State['chat'] = [
    ['user', 'Estoy en el día 9 y ya no doy más, extraño a mis hijos.'],
    ['companion', 'Te entiendo, Matías. Nueve días lejos pesan, y más con turno noche. Extrañar a tus hijos habla de lo mucho que te importan. ¿Pudiste hablar con ellos en estos días?'],
    ['user', 'Poco, la señal es mala.'],
    ['companion', 'Qué bronca, eso lo hace más difícil. Si querés, podemos pensar juntos un momento del día para intentarlo, o podés grabarles un audio ahora para mandarlo cuando haya señal. ¿Qué te parece?'],
  ].map(([role, text], i) => ({ id: `chat-${i}`, role: role as 'user' | 'companion', text: text!, createdAt: iso(new Date(y.getTime() + i * 60_000)), riesgo: 'ninguno' }));
  return {
    consents: { ...DEFAULT_CONSENTS },
    otorgado: true,
    checkins,
    seq: checkins.size,
    chat,
    shared: 0,
    devices: [
      { ...DEV.phone, efimero: false, ultimaSync: null, ultimaSyncIso: iso(new Date(Date.now() - 2 * 60_000)), actual: false, cerrado: false },
      { ...DEV.tablet, efimero: true, ultimaSync: null, ultimaSyncIso: iso(daysAgo(0, 6, 14)), actual: false, cerrado: false },
      { ...DEV.laptop, efimero: false, ultimaSync: null, ultimaSyncIso: iso(daysAgo(3, 21, 10)), actual: false, cerrado: false },
    ],
    challenge: null,
    sub: {
      orgId: ORG.id,
      proveedor: null,
      planId: null,
      estado: 'sin_suscripcion',
      puestos: 0,
      puestosEnUso: 9,
      moneda: null,
      proximoCobro: null,
      canceladaAlFinal: false,
      actualizadaEn: null,
    },
    kiosks: [{ id: 'k1', nombre: 'Tablet comedor — Módulo 3', creado_en: iso(daysAgo(40)), revocado_en: null }],
    seenMutations: new Set(),
  };
}

let S = freshState();

const PLANS = [
  {
    id: 'faena-mensual',
    nombre: 'Faena · mensual',
    descripcion: 'Companion para cada trabajador de la faena, kiosco incluido. Se cobra por puesto activo.',
    intervalo: 'mensual',
    precioPorPuesto: { USD: 900, ARS: 900_000, CLP: 8_500 },
    minimoPuestos: 20,
  },
  { id: 'faena-anual', nombre: 'Faena · anual', descripcion: 'Igual al mensual, con un pago por año.', intervalo: 'anual', precioPorPuesto: { USD: 9_000, ARS: 9_000_000, CLP: 85_000 }, minimoPuestos: 20 },
];
const PROVIDERS = [
  { id: 'sandbox', nombre: 'Pasarela de prueba', monedas: ['USD', 'ARS', 'CLP'] },
  { id: 'stripe', nombre: 'Stripe (simulado en la demo)', monedas: ['USD'] },
  { id: 'mercadopago', nombre: 'Mercado Pago (simulado en la demo)', monedas: ['ARS'] },
];

// ---------- Sesiones ----------
// Token = "demo:<rol>:<deviceId>:<kind>"
type Who = 'worker' | 'admin';
function session(token: string | null): { who: Who; deviceId: string; kind: string } {
  const [p, who, deviceId, kind] = (token ?? '').split(':');
  if (p !== 'demo' || (who !== 'worker' && who !== 'admin')) throw new MockError(401, 'sesion_invalida');
  return { who, deviceId: deviceId!, kind: kind! };
}

function perfil(who: Who) {
  const u = USERS[who];
  return {
    ...u,
    org: ORG,
    roster: ROSTER,
    consents: S.consents,
    consentimientoOtorgado: S.otorgado,
  };
}

function openSession(who: Who, device: { kind: string; nombre: string; sistema: string; id?: string | null }) {
  const deviceId = device.id ?? `d-${uid().slice(0, 8)}`;
  if (who === 'worker' && device.kind !== 'kiosk' && !S.devices.some((d) => d.id === deviceId)) {
    S.devices.push({ id: deviceId, kind: device.kind as DeviceInfo['kind'], nombre: device.nombre, sistema: device.sistema, efimero: false, ultimaSync: null, ultimaSyncIso: iso(now()), actual: false, cerrado: false });
  }
  return { paso: 'listo', token: `demo:${who}:${deviceId}:${device.kind}`, deviceId, inactividadS: 900, perfil: perfil(who) };
}

// ---------- Acompañante básico (mismas reglas que el servidor sin modelo) ----------
const QUICK: Record<string, string> = {
  'Estoy cansado': 'Tiene sentido, el turno noche se siente en el cuerpo. ¿Querés que hagamos juntos una respiración de 2 minutos, o preferís contarme cómo viene el día?',
  'Extraño a mi familia': 'Es de lo más difícil del roster. ¿Hay algo que te gustaría decirles? Lo podemos dejar listo para cuando haya señal.',
  'No puedo dormir': 'Dormir de día cuesta. Tengo algunas ideas cortas para el turno noche. ¿Te las paso, o querés contarme qué te despierta?',
  'Solo quiero charlar': 'Dale, acá estoy. ¿De qué tenés ganas de hablar?',
};

// ---------- Enrutador ----------

export async function mockApi(path: string, method: string, body: unknown, token: string | null): Promise<unknown> {
  await new Promise((r) => setTimeout(r, path.startsWith('/companion/messages') && method === 'POST' ? 900 : 120));
  const [route, qs] = path.split('?');
  const q = new URLSearchParams(qs ?? '');
  const b = (body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const key = `${method} ${route}`;

  switch (key) {
    case 'GET /config':
      return DEFAULT_CONFIG;
    case 'GET /health':
      return { ok: true };

    case 'POST /auth/login': {
      const ident = String(b.identificador ?? '').replace(/\./g, '').trim().toLowerCase();
      const who: Who | null =
        (ident === 'mrodriguez' || ident === '30456789') && b.password === 'serena-demo' ? 'worker' : ident === 'admin' && b.password === 'serena-admin' ? 'admin' : null;
      if (!who) throw new MockError(401, 'credenciales', 'El usuario o la contraseña no coinciden.');
      const code = String(Math.floor(100000 + Math.random() * 900000));
      S.challenge = { id: uid(), code, who };
      return { paso: 'segundo_factor', challengeId: S.challenge.id, telefonoTermina: who === 'worker' ? '47' : '99', codigoDesarrollo: code };
    }
    case 'POST /auth/resend': {
      if (!S.challenge) throw new MockError(404, 'desafio_inexistente');
      S.challenge.code = String(Math.floor(100000 + Math.random() * 900000));
      return { ok: true, codigoDesarrollo: S.challenge.code };
    }
    case 'POST /auth/verify': {
      if (!S.challenge || S.challenge.id !== b.challengeId) throw new MockError(401, 'codigo_vencido', 'El código venció. Pedí uno nuevo.');
      if (b.codigo !== S.challenge.code) throw new MockError(401, 'codigo_incorrecto', 'El código no coincide. Revisá los 6 dígitos o pedí uno nuevo.');
      const who = S.challenge.who;
      S.challenge = null;
      return openSession(who, b.device);
    }
    case 'POST /auth/kiosk': {
      const ok = (b.legajo === '04817' && b.pin === '1234') || (b.qr && String(b.qr).trim().toUpperCase() === 'QR-DEMO-04817');
      if (!ok) throw new MockError(401, 'credencial', 'No pudimos identificarte. Revisá el legajo y el PIN.');
      return openSession('worker', { kind: 'kiosk', nombre: 'Tablet comedor — Módulo 3', sistema: 'Kiosco', id: DEV.tablet.id });
    }
    case 'POST /auth/logout':
      return { ok: true };
  }

  const s = session(token);

  switch (key) {
    case 'GET /me':
      return { perfil: perfil(s.who), sesion: { deviceId: s.deviceId, deviceKind: s.kind, efimera: s.kind === 'kiosk' } };
    case 'PUT /consents':
      S.consents = { camara: !!b.camara, animo: !!b.animo, reaccion: !!b.reaccion, chat: !!b.chat, geo: !!b.geo };
      S.otorgado = true;
      return { perfil: perfil(s.who) };

    case 'GET /devices':
      return {
        dispositivos: S.devices.map((d) => ({ ...d, ultimaSync: d.id === s.deviceId ? iso(now()) : d.ultimaSyncIso, actual: d.id === s.deviceId })),
      };

    case 'POST /sync/push': {
      const resultados = (b.mutations as SyncMutation<CheckIn | Consents>[]).map((m) => {
        if (S.seenMutations.has(m.mutationId)) return { mutationId: m.mutationId, status: 'duplicada' };
        S.seenMutations.add(m.mutationId);
        if (m.entity === 'consents') {
          S.consents = m.data as Consents;
          return { mutationId: m.mutationId, status: 'aplicada' };
        }
        const cur = S.checkins.get(m.id);
        if (cur && Date.parse(cur.c.updatedAt) > Date.parse(m.updatedAt)) return { mutationId: m.mutationId, status: 'descartada' };
        if (m.op === 'delete') {
          if (cur) S.checkins.set(m.id, { ...cur, deleted: true, seq: ++S.seq });
        } else {
          const d = applyConsents(m.data as CheckIn, S.consents, S.otorgado);
          if (!d.ok) return { mutationId: m.mutationId, status: 'rechazada', motivo: d.motivo };
          const c = d.checkin;
          c.nivel = classify(c, DEFAULT_CONFIG.niveles);
          S.checkins.set(m.id, { c, seq: ++S.seq, deleted: false });
        }
        return { mutationId: m.mutationId, status: 'aplicada' };
      });
      return { resultados };
    }
    case 'GET /sync/pull': {
      const since = Number(q.get('cursor') ?? '0');
      const rows = [...S.checkins.values()].filter((r) => r.seq > since).sort((a, b2) => a.seq - b2.seq);
      return {
        cursor: String(rows.length ? rows[rows.length - 1]!.seq : since),
        hayMas: false,
        cambios: rows.map((r) => ({ entity: 'checkin', id: r.c.id, deleted: r.deleted, data: r.deleted ? null : r.c, updatedAt: r.c.updatedAt, deviceId: r.c.deviceId })),
      };
    }

    case 'GET /companion/messages': {
      if (s.kind === 'kiosk') return { mensajes: [], cuidado: false };
      const cuidado = S.chat.some((m) => m.riesgo === 'alto');
      return { mensajes: S.chat.map(({ riesgo: _r, ...m }) => m), cuidado };
    }
    case 'POST /companion/messages': {
      if (!S.consents.chat) throw new MockError(403, 'sin_consentimiento', 'Activá la conversación con el acompañante en Privacidad.');
      const text = String(b.text ?? '').trim();
      const riesgo = detectRisk(text);
      const reply =
        riesgo === 'alto'
          ? 'Gracias por contármelo, Matías. Estoy acá con vos y no me voy. Lo que sentís importa y no tenés que cargarlo solo. ¿Estás en un lugar seguro ahora?'
          : (QUICK[text] ??
            (riesgo === 'posible'
              ? 'Suena a que venís cargando mucho. Gracias por decirlo. Si querés, te conecto con una persona de la guardia, o seguimos charlando acá, sin apuro.'
              : 'Te leo. Contame un poco más, sin apuro.'));
      const t = now();
      const u = { id: b.id ?? uid(), role: 'user' as const, text, createdAt: iso(t), riesgo };
      const c = { id: uid(), role: 'companion' as const, text: reply, createdAt: iso(new Date(t.getTime() + 1)), riesgo: 'ninguno' };
      if (s.kind !== 'kiosk') S.chat.push(u, c);
      const strip = ({ riesgo: _r, ...m }: { id: string; role: 'user' | 'companion'; text: string; createdAt: string; riesgo: string }) => m;
      return { mensajes: [strip(u), strip(c)], cuidado: riesgo === 'alto', riesgo };
    }

    case 'POST /emergency':
      S.shared++;
      return { id: b.id, estado: 'enviado', canal: 'GUARDIA DE FAENA (PEC) · SIMULADO', recibidoEn: iso(now()) };

    case 'GET /privacy/access-log':
      return { compartida90d: S.shared, registros: [] };
    case 'DELETE /privacy/history':
      for (const [id, r] of S.checkins) S.checkins.set(id, { ...r, deleted: true, seq: ++S.seq });
      S.chat = [];
      return { ok: true };
    case 'POST /privacy/withdraw':
      S.consents = { camara: false, animo: false, reaccion: false, chat: false, geo: false };
      S.otorgado = false;
      return { perfil: perfil(s.who) };
    case 'GET /privacy/export':
      throw new MockError(400, 'demo', 'En la vista previa no se descargan archivos. En la app real se descarga un JSON con todos tus datos.');
  }

  if (route?.startsWith('/devices/') && method === 'DELETE') {
    const d = S.devices.find((x) => x.id === route.slice('/devices/'.length));
    if (d) d.cerrado = true;
    return { ok: true };
  }

  // ---------- Administración ----------
  if (route?.startsWith('/admin') && s.who !== 'admin') throw new MockError(403, 'sin_permiso');
  switch (key) {
    case 'GET /admin/stats': {
      if (S.sub.estado !== 'activa') throw new MockError(402, 'suscripcion_inactiva', 'Los reportes requieren una suscripción activa. Probá contratar con la pasarela de prueba en Facturación.');
      // Niveles sintéticos por persona y día (b = bien, m = moderado, a = alto), elegidos para que
      // la demo muestre todos los casos del control de divulgación.
      const grupos = [
        'bbbbbbbm', 'bbbbb', 'bbbbbm', 'bbb', 'bbmm', 'bbbbmmm', 'bbbmma', 'bbba',
        'bbbbmmmaaa', 'bbbmmm', 'mmmaa', 'bbb', 'bbbmmaaa', 'bbbbmm',
      ];
      const lv = { b: 'bajo', m: 'moderado', a: 'alto' } as const;
      return {
        periodo: ventanaReporte(),
        ventanaDias: 28,
        kAnonimato: K_GRUPO,
        kCelda: K_CELDA,
        participacion: { personas: 9, checkins: 118, activos: 9 },
        porDiaDeRoster: grupos.map((g, i) => ({ dia: i + 1, ...publicarDistribucion([...g].map((c) => lv[c as 'b' | 'm' | 'a'])) })),
        escalamientos28d: 'menos de 5',
      };
    }
    case 'GET /admin/kiosks':
      return { kioscos: S.kiosks };
    case 'POST /admin/kiosks': {
      const k = { id: uid(), nombre: String(b.nombre), creado_en: iso(now()), revocado_en: null };
      S.kiosks.push(k);
      return { id: k.id, nombre: k.nombre, token: `kiosco-demo-${uid()}` };
    }
    case 'POST /admin/workers':
      S.sub.puestosEnUso++;
      return {
        id: uid(),
        credenciales: { dni: b.dni, passwordInicial: 'demo-' + uid().slice(0, 6), pinKiosco: String(1000 + Math.floor(Math.random() * 9000)), qrCredencial: 'QR-DEMO-' + uid().slice(0, 6) },
      };
    case 'GET /admin/billing':
      return { suscripcion: S.sub, planes: PLANS, proveedores: PROVIDERS };
    case 'POST /admin/billing/checkout': {
      const plan = PLANS.find((p) => p.id === b.planId);
      if (!plan) throw new MockError(400, 'plan_inexistente');
      if (b.puestos < plan.minimoPuestos) throw new MockError(400, 'minimo_puestos', `El plan requiere al menos ${plan.minimoPuestos} puestos.`);
      const id = uid();
      S.sub = { ...S.sub, estado: 'pendiente', proveedor: b.proveedor, planId: plan.id, puestos: b.puestos, moneda: b.moneda, checkout: { id, planId: plan.id, puestos: b.puestos, moneda: b.moneda } };
      const qp = new URLSearchParams({ checkout: id, plan: plan.nombre, puestos: String(b.puestos), moneda: b.moneda });
      return { url: `/admin/facturacion/sandbox?${qp}`, checkoutId: id };
    }
    case 'POST /admin/billing/sandbox/complete': {
      const aprobado = !!b.aprobado;
      if (aprobado) {
        const next = now();
        next.setMonth(next.getMonth() + 1);
        S.sub = { ...S.sub, estado: 'activa', proximoCobro: iso(next), actualizadaEn: iso(now()), canceladaAlFinal: false };
      } else S.sub = { ...S.sub, estado: 'pendiente' };
      return { ok: true };
    }
    case 'POST /admin/billing/cancel':
      S.sub = { ...S.sub, canceladaAlFinal: true };
      return { suscripcion: S.sub };
    case 'POST /admin/billing/portal':
      throw new MockError(404, 'portal_no_disponible', 'El portal del proveedor no está disponible en la vista previa.');
  }

  if (route?.startsWith('/admin/kiosks/') && method === 'DELETE') {
    const k = S.kiosks.find((x) => x.id === route.slice('/admin/kiosks/'.length));
    if (k) k.revocado_en = iso(now());
    return { ok: true };
  }

  throw new MockError(404, 'no_encontrado');
}

export function resetDemo() {
  S = freshState();
}
