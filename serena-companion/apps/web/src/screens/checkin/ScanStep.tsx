import { useEffect, useRef, useState } from 'react';
import { fmt, METRIC_LABELS, type ScanMetrics, type ScanResult } from '@serena/domain';
import { getScanProvider, scanMode } from '../../scan/registry.ts';

type Ind = { valor: number | null; estable: boolean };
const ORDER: Array<keyof ScanMetrics> = ['pulso', 'hrv', 'respiracion', 'estres'];

/** 6.7 Paso 3: escaneo NeuroSentinel™ (slot del SDK). */
export function ScanStep({ stream, duracionS, onDone, onAbort }: { stream: MediaStream | null; duracionS: number; onDone: (r: ScanResult) => void; onAbort: () => void }) {
  const [progress, setProgress] = useState(0);
  const [ind, setInd] = useState<Record<keyof ScanMetrics, Ind>>({
    pulso: { valor: null, estable: false },
    hrv: { valor: null, estable: false },
    respiracion: { valor: null, estable: false },
    estres: { valor: null, estable: false },
  });
  const [lost, setLost] = useState<number | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => undefined);
    }
    let alive = true;
    let lostTimer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const p = await getScanProvider();
      try {
        await p.start({ duracionS }, (e) => {
          if (!alive) return;
          if (e.type === 'progreso') setProgress(e.valor);
          else if (e.type === 'metrica') setInd((cur) => ({ ...cur, [e.nombre]: { valor: e.valor, estable: e.estable } }));
          else if (e.type === 'senal_perdida') {
            setLost(3);
            if (lostTimer) clearInterval(lostTimer);
            lostTimer = setInterval(() => setLost((n) => (n && n > 1 ? n - 1 : (lostTimer && clearInterval(lostTimer), null))), 1000);
          } else if (e.type === 'completo') setResult(e.resultado);
          else if (e.type === 'error') setFailed(true);
        });
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (lostTimer) clearInterval(lostTimer);
      void getScanProvider().then((p) => p.stop());
    };
  }, [stream, duracionS]);

  const rem = Math.max(0, Math.round(duracionS * (1 - progress)));
  const clock = `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
  const C = 2 * Math.PI * 48;

  return (
    <>
      <div className="row" style={{ justifyContent: 'center' }}>
        <div className="label cyan">NEUROSENTINEL™</div>
        {scanMode === 'simulado' && <span className="sim-chip">SIMULACIÓN · SIN SDK · VALORES NO REALES</span>}
      </div>
      <div className="scan-stage" ref={slot} data-scan-slot="scan">
        <div className="scan-halo" data-anim />
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'rotate(-90deg)' }} aria-hidden="true">
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="1.2" />
          <circle cx="50" cy="50" r="48" fill="none" stroke="#2FA8C0" strokeWidth="1.6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
        </svg>
        <div className="scan-oval">{stream && <video ref={video} muted playsInline aria-hidden="true" />}</div>
      </div>

      {failed ? (
        <div className="stack" style={{ alignItems: 'center', gap: 14, maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <p style={{ fontSize: 17 }}>No pudimos completar la lectura. Podés terminar el check-in sin escaneo.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={onAbort}>
            Continuar sin escaneo
          </button>
        </div>
      ) : result ? (
        <div className="stack" style={{ alignItems: 'center', gap: 14, maxWidth: 420, width: '100%' }}>
          <div className="display" style={{ fontSize: 28 }}>
            Lectura completa
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => onDone(result)}>
            Continuar
          </button>
        </div>
      ) : (
        <div className="stack" style={{ alignItems: 'center', gap: 8 }} aria-live="polite">
          <div className="display num" style={{ fontSize: 'clamp(48px, 7cqi, 72px)', lineHeight: 1, fontFamily: 'var(--font-display)' }}>
            {clock}
          </div>
          <div className="muted" style={{ fontSize: 18 }}>
            {lost ? 'Quedate quieto un momento.' : 'Respirá normal. Quedate quieto.'}
          </div>
        </div>
      )}
      {lost !== null && (
        <div role="status" style={{ fontSize: 16, color: 'var(--warn-fg)', background: 'var(--warn-bg)', padding: '12px 18px', borderRadius: 12, textAlign: 'center' }}>
          Perdimos la señal por movimiento. Retomamos en {lost} segundos.
        </div>
      )}
      <div className="grid" style={{ ['--min' as string]: '150px', gap: 10, width: '100%', maxWidth: 860 }}>
        {ORDER.map((k) => {
          const m = METRIC_LABELS[k];
          const v = ind[k];
          const on = v.estable && v.valor !== null;
          return (
            <div key={k} className={`value-card ${on ? 'stable' : ''}`}>
              <div className="muted" style={{ fontSize: 14 }}>
                {m.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="v" style={{ color: on ? 'var(--c-text)' : 'var(--c-meta)' }}>
                  {on ? fmt(v.valor!, m.decimales) : '—'}
                </span>
                {on && (
                  <span className="meta" style={{ fontSize: 13 }}>
                    {m.unidad}
                  </span>
                )}
              </div>
              <div className="label" style={{ fontSize: 10, color: on ? 'var(--ok-fg)' : 'var(--c-meta)' }}>
                {on ? 'ESTABLE' : 'ESTABILIZANDO'}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
