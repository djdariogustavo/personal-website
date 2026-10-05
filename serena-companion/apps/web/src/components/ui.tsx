import type { ReactNode } from 'react';
import type { Level } from '@serena/domain';

/** Íconos lineales de 1,5 px (trazos del prototipo). */
export const ICONS = {
  hoy: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  checkin: 'M2 12h4l2.5-6 4.5 12 2.5-6H22',
  chat: 'M4 4h16v12H10l-6 4z',
  bienestar: 'M4 4v16h16M8 15l3.5-4 3 2.5L20 7',
  recursos: 'M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1zM12 6v14',
  privacidad: 'M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z',
  dispositivos: 'M3 5h13v10H3zM1 19h17M19 8h4v12h-4z',
  mobile: 'M8 2h8v20H8zM11 18h2',
  tablet: 'M4 3h16v18H4zM11 18h2',
  kiosk: 'M4 3h16v18H4zM11 18h2',
  desktop: 'M5 5h14v10H5zM2 19h20',
  lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
  signal: 'M12 13v8M8.8 9.8a4.5 4.5 0 0 1 6.4 0M5.6 6.6a9 9 0 0 1 12.8 0',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5-2.7M14 10.2a10 10 0 0 1 5 2.9M2 9a15 15 0 0 1 5-3M11 5a15 15 0 0 1 11 4',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v6M12 7.5v.5',
  send: 'M4 12h15M13 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  camOff: 'M3 3l18 18M9 5h6l2 2h3v11M20 20H4V7h3',
  sun: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 1v2M12 21v2M1 12h2M21 12h2',
  logout: 'M10 4H4v16h6M16 8l4 4-4 4M20 12H9',
  billing: 'M3 6h18v12H3zM3 10h18M7 15h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  users: 'M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 20c0-3-2-5-5-5',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, stroke = 'currentColor', width = 1.5 }: { name: IconName; size?: number; stroke?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', stroke }}>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)}>
      <span className="track">
        <span className="knob" />
      </span>
    </button>
  );
}

const STEP_LABELS = ['1 Ánimo', '2 Luz y encuadre', '3 Escaneo', '4 Reacción'];
export function StepProgress({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <div className="steps" aria-label={`Paso ${current + 1} de 4`}>
      {STEP_LABELS.map((l, i) => (
        <div key={l} className={`${i <= current ? 'done' : ''} ${i === current ? 'current' : ''}`}>
          <div className="bar" />
          <div className="label">{l}</div>
        </div>
      ))}
    </div>
  );
}

export function LevelChip({ level, children }: { level: Level; children: ReactNode }) {
  const cls = level === 'bajo' ? 'chip-ok' : level === 'moderado' ? 'chip-warn' : 'chip-alert';
  return <span className={`chip ${cls}`}>{children}</span>;
}

export function Seal({ children }: { children: ReactNode }) {
  return (
    <div className="seal">
      <Icon name="lock" size={14} />
      {children}
    </div>
  );
}

export function PinDots({ n, total = 4 }: { n: number; total?: number }) {
  return (
    <div className="pin-dots" role="img" aria-label={`${n} de ${total} dígitos`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < n ? 'on' : ''} />
      ))}
    </div>
  );
}

export function PinPad({ onDigit, onDelete, extra }: { onDigit: (d: string) => void; onDelete: () => void; extra?: { label: string; onClick: () => void } | null }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="keypad">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => onDigit(k)}>
          {k}
        </button>
      ))}
      {extra ? (
        <button type="button" onClick={extra.onClick} style={{ fontSize: 15 }}>
          {extra.label}
        </button>
      ) : (
        <span />
      )}
      <button type="button" onClick={() => onDigit('0')}>
        0
      </button>
      <button type="button" onClick={onDelete} style={{ fontSize: 15 }} aria-label="Borrar">
        Borrar
      </button>
    </div>
  );
}

export function Ring({ size, r, stroke, progress, children }: { size: number; r: number; stroke: number; progress: number; children?: ReactNode }) {
  const C = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="ring">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.max(0, Math.min(1, progress)))}
          style={{ stroke: 'var(--c-cyan)', transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span className="num" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </span>
    </div>
  );
}

export function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Hoy · 06:12", "Ayer · 05:48" o "12/09 · 18:40". */
export function whenLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  const day = days === 0 ? 'Hoy' : days === 1 ? 'Ayer' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  return `${day} · ${hhmm(iso)}`;
}
