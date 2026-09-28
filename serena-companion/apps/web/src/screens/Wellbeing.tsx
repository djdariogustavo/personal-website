import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmt, LEVEL_COPY, rosterInsight, rosterStatus, selfReportScore, type CheckIn } from '@serena/domain';
import { api, ApiError } from '../lib/api.ts';
import { useApp, useCheckins } from '../lib/store.tsx';
import { Icon, LevelChip, whenLabel, type IconName } from '../components/ui.tsx';

type Metric = 'estres' | 'hrv' | 'sueno' | 'animo';
const METRICS: Record<Metric, { label: string; min: number; max: number; unit: string; dec: number; of: (c: CheckIn) => number | null }> = {
  estres: { label: 'Estrés', min: 1, max: 5, unit: '1–5', dec: 1, of: (c) => c.escaneo?.metricas.estres ?? null },
  hrv: { label: 'Variabilidad', min: 20, max: 80, unit: 'ms', dec: 0, of: (c) => c.escaneo?.metricas.hrv ?? null },
  // Sueño declarado: punto medio del rango elegido.
  sueno: { label: 'Sueño declarado', min: 3, max: 9, unit: 'h', dec: 0, of: (c) => (c.sueno === null ? null : ([3.5, 5, 7, 8.5][c.sueno] ?? null)) },
  // Ánimo: 5 = muy bien, 1 = muy cansado.
  animo: { label: 'Ánimo', min: 1, max: 5, unit: '1–5', dec: 0, of: (c) => (c.animo === null ? null : 5 - c.animo) },
};

export async function downloadMyData() {
  const res = await api<Response>('/privacy/export', { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `serena-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 6.11 Mi bienestar: 28 días con bandas de trabajo/descanso del roster. */
export function Wellbeing() {
  const { session } = useApp();
  const checkins = useCheckins();
  const [metric, setMetric] = useState<Metric>('estres');
  const [hover, setHover] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const roster = session!.perfil.roster;

  const days = useMemo(() => {
    const out: Array<{ date: Date; work: boolean; dia: number; items: CheckIn[] }> = [];
    const today = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const st = rosterStatus(roster, d);
      const items = checkins.filter((c) => new Date(c.createdAt).toDateString() === d.toDateString());
      out.push({ date: d, work: st.enTurno, dia: st.dia, items });
    }
    return out;
  }, [checkins, roster]);

  const m = METRICS[metric];
  const y = (v: number) => 8 + (1 - (Math.max(m.min, Math.min(m.max, v)) - m.min) / (m.max - m.min)) * 84;
  const pts = days
    .map((d, i) => {
      const vals = d.items.map(m.of).filter((v): v is number => v !== null);
      if (!vals.length) return null;
      const v = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { i, v, x: ((i + 0.5) / 28) * 100, y: y(v), d };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const bands: Array<{ work: boolean; start: number; n: number }> = [];
  days.forEach((d, i) => {
    const b = bands[bands.length - 1];
    if (b && b.work === d.work) b.n++;
    else bands.push({ work: d.work, start: i, n: 1 });
  });
  const insight = rosterInsight(checkins, roster.diasTrabajo);
  const todaySt = rosterStatus(roster);
  const hp = hover !== null ? pts.find((p) => p.i === hover) : null;
  const valor = (p: (typeof pts)[number]) => `${fmt(p.v, m.dec)} ${m.unit === '1–5' ? 'de 5' : m.unit}`;

  // Todo el gráfico es el objetivo táctil (WCAG 2.5.8): se elige el día más cercano al dedo o al puntero.
  // Con teclado: un único foco que se recorre con las flechas; el valor se anuncia por aria-live.
  function cercano(e: PointerEvent<HTMLDivElement>) {
    if (!pts.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    setHover(pts.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a)).i);
  }
  function teclas(e: KeyboardEvent<HTMLDivElement>) {
    if (!pts.length) return;
    const k = pts.findIndex((p) => p.i === hover);
    const next = { ArrowLeft: Math.max(0, k - 1), ArrowRight: Math.min(pts.length - 1, k < 0 ? 0 : k + 1), Home: 0, End: pts.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setHover(pts[next]!.i);
  }

  return (
    <div className="screen">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <h1 className="h1" style={{ fontSize: 'clamp(28px, 4.4cqi, 44px)' }}>
          Mi bienestar
        </h1>
        <button type="button" className="btn" style={{ minHeight: 48, fontSize: 15 }} onClick={() => void downloadMyData().catch((e) => setNotice(e instanceof ApiError && e.mensaje ? e.mensaje : 'Necesitás conexión para descargar tus datos.'))}>
          Descargar mis datos
        </button>
      </div>
      {notice && <div className="warn-text">{notice}</div>}
      <div className="row" style={{ gap: 6 }} role="group" aria-label="Métrica">
        {(Object.keys(METRICS) as Metric[]).map((k) => (
          <button key={k} type="button" className="pill" aria-pressed={metric === k} onClick={() => setMetric(k)}>
            {METRICS[k].label}
          </button>
        ))}
      </div>
      <figure className="card" style={{ padding: 20, margin: 0, gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <figcaption className="label">{m.label} · ÚLTIMOS 28 DÍAS</figcaption>
          <div className="row muted" style={{ gap: 14, fontSize: 12 }}>
            <span className="row" style={{ gap: 6 }}>
              <span style={{ width: 12, height: 12, background: '#20205D', border: '1px solid rgba(255,255,255,.2)' }} />
              Trabajo
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span style={{ width: 12, height: 12, background: '#101052', border: '1px solid rgba(255,255,255,.2)' }} />
              Descanso
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="num meta" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10.5, padding: '12px 0', whiteSpace: 'nowrap' }} aria-hidden="true">
            <span>{m.unit === '1–5' ? m.max : `${m.max} ${m.unit}`}</span>
            <span>{m.unit === '1–5' ? m.min : `${m.min} ${m.unit}`}</span>
          </div>
          <div
            className="chart"
            tabIndex={pts.length ? 0 : -1}
            role="group"
            aria-label={`Gráfico de ${m.label.toLowerCase()} de los últimos 28 días. Usá las flechas izquierda y derecha para recorrer los días.`}
            onPointerMove={cercano}
            onPointerDown={cercano}
            onPointerLeave={() => setHover(null)}
            onKeyDown={teclas}
            onFocus={() => hover === null && pts.length && setHover(pts[pts.length - 1]!.i)}
            onBlur={() => setHover(null)}
            style={{ touchAction: 'pan-y' }}
          >
            {bands.map((b) => (
              <div key={b.start} className="band" style={{ left: `${(b.start / 28) * 100}%`, width: `${(b.n / 28) * 100}%`, background: b.work ? '#20205D' : '#101052' }}>
                {b.n >= 6 && <span>{b.work ? 'TRABAJO' : 'DESCANSO'}</span>}
              </div>
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
              {hp && <line x1={hp.x} x2={hp.x} y1={0} y2={100} stroke="rgba(255,255,255,.25)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              <path d={path} fill="none" style={{ stroke: 'var(--c-cyan)' }} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            {pts.map((p) => (
              <span key={p.i} className={`pt ${hover === p.i ? 'on' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden="true" />
            ))}
            {hp && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${Math.min(80, Math.max(2, hp.x - 10))}%`,
                  top: hp.y > 50 ? 12 : 'auto',
                  bottom: hp.y > 50 ? 'auto' : 12,
                  background: 'var(--c-bg)',
                  border: '1px solid var(--c-line)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 13,
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                <div className="meta" style={{ fontSize: 11 }}>
                  {p2label(hp.d)}
                </div>
                <div>
                  {m.label}: <strong className="num">{fmt(hp.v, m.dec)}</strong> {m.unit === '1–5' ? 'de 5' : m.unit}
                </div>
              </div>
            )}
            <div className="sr-only" aria-live="polite">
              {hp ? `${p2label(hp.d)}: ${m.label} ${valor(hp)}` : ''}
            </div>
          </div>
        </div>
        <div className="row label" style={{ justifyContent: 'space-between', fontSize: 10.5, paddingLeft: 52 }}>
          <span>HACE 28 DÍAS</span>
          <span>HOY · {todaySt.enTurno ? `DÍA ${todaySt.dia}` : `DESCANSO ${todaySt.dia}`}</span>
        </div>
        {!pts.length && <p className="muted">Todavía no hay datos de {m.label.toLowerCase()} en estos 28 días.</p>}
        {/* Equivalente en tabla para lectores de pantalla. */}
        {pts.length > 0 && (
          <div className="sr-only">
            <table>
              <caption>
                {m.label} por día, últimos 28 días
              </caption>
              <thead>
                <tr>
                  <th scope="col">Día</th>
                  <th scope="col">{m.label}</th>
                </tr>
              </thead>
              <tbody>
                {pts.map((p) => (
                  <tr key={p.i}>
                    <th scope="row">{p2label(p.d)}</th>
                    <td>{valor(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </figure>
      <div className="card accent" style={{ gap: 8 }}>
        <div className="label cyan">LO QUE VEMOS EN TUS DATOS</div>
        <p style={{ fontSize: 17 }}>{insight.texto}</p>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="label">MIS CHECK-INS</div>
        {checkins.length === 0 ? (
          <p className="muted">Todavía no hay check-ins.</p>
        ) : (
          <div className="list">
            {checkins.slice(0, 40).map((c) => (
              <HistoryRow key={c.id} c={c} roster={roster} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function p2label(d: { date: Date; work: boolean; dia: number }) {
  return `${d.date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · ${d.work ? `DÍA ${d.dia}` : `DESCANSO ${d.dia}`}`.toUpperCase();
}

function HistoryRow({ c, roster }: { c: CheckIn; roster: Parameters<typeof rosterStatus>[0] }) {
  const st = rosterStatus(roster, new Date(c.createdAt));
  const icon: IconName = c.deviceKind === 'desktop' ? 'desktop' : c.deviceKind === 'mobile' ? 'mobile' : 'tablet';
  const sr = selfReportScore(c.animo, c.sueno);
  return (
    <div className="list-row">
      <Icon name={icon} stroke="#B8B8CB" />
      <div className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <div style={{ fontSize: 15.5, fontWeight: 500 }}>{whenLabel(c.createdAt)}</div>
        <div className="muted" style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.deviceName}
          {!c.escaneo && sr !== null ? ' · autorreporte' : ''}
          {c.nota ? ` · “${c.nota}”` : ''}
        </div>
      </div>
      <span className="label" style={{ fontSize: 10.5 }}>
        {st.enTurno ? `DÍA ${st.dia}` : `DESC. ${st.dia}`}
      </span>
      <LevelChip level={c.nivel}>{LEVEL_COPY[c.nivel].historial}</LevelChip>
    </div>
  );
}
