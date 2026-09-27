import { useMemo, useState } from 'react';
import { fmt, LEVEL_COPY, rosterInsight, rosterStatus, selfReportScore, type CheckIn } from '@serena/domain';
import { api } from '../lib/api.ts';
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

  return (
    <div className="screen">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <h1 className="h1" style={{ fontSize: 'clamp(28px, 4.4cqi, 44px)' }}>
          Mi bienestar
        </h1>
        <button type="button" className="btn" style={{ minHeight: 48, fontSize: 15 }} onClick={() => void downloadMyData().catch(() => setNotice('Necesitás conexión para descargar tus datos.'))}>
          Descargar mis datos
        </button>
      </div>
      {notice && <div className="warn-text">{notice}</div>}
      <div className="row" style={{ gap: 6 }} role="tablist" aria-label="Métrica">
        {(Object.keys(METRICS) as Metric[]).map((k) => (
          <button key={k} type="button" role="tab" className="pill" aria-pressed={metric === k} aria-selected={metric === k} onClick={() => setMetric(k)}>
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
          <div className="chart" onMouseLeave={() => setHover(null)}>
            {bands.map((b) => (
              <div key={b.start} className="band" style={{ left: `${(b.start / 28) * 100}%`, width: `${(b.n / 28) * 100}%`, background: b.work ? '#20205D' : '#101052' }}>
                {b.n >= 6 && <span>{b.work ? 'TRABAJO' : 'DESCANSO'}</span>}
              </div>
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
              {hp && <line x1={hp.x} x2={hp.x} y1={0} y2={100} stroke="rgba(255,255,255,.25)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              <path d={path} fill="none" stroke="#2FA8C0" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            {pts.map((p) => (
              <button
                key={p.i}
                type="button"
                className="pt"
                style={{ left: `${p.x}%`, top: `${p.y}%`, padding: 0, width: hover === p.i ? 13 : 9, height: hover === p.i ? 13 : 9, margin: hover === p.i ? '-6.5px 0 0 -6.5px' : undefined }}
                aria-label={`${p.d.date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}: ${m.label} ${fmt(p.v, m.dec)}`}
                onMouseEnter={() => setHover(p.i)}
                onFocus={() => setHover(p.i)}
                onBlur={() => setHover(null)}
              />
            ))}
            {hp && (
              <div
                role="tooltip"
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
          </div>
        </div>
        <div className="row label" style={{ justifyContent: 'space-between', fontSize: 10.5, paddingLeft: 52 }}>
          <span>HACE 28 DÍAS</span>
          <span>HOY · {todaySt.enTurno ? `DÍA ${todaySt.dia}` : `DESCANSO ${todaySt.dia}`}</span>
        </div>
        {!pts.length && <p className="muted">Todavía no hay datos de {m.label.toLowerCase()} en estos 28 días.</p>}
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
