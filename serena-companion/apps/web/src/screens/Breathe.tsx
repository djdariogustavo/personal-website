import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

/** Respiración guiada: ciclo de 10 s (inhalar 4 s, exhalar 6 s). Con "reducir movimiento" queda solo el contador. */
export function Breathe({ kiosk = false }: { kiosk?: boolean }) {
  const [params] = useSearchParams();
  const min = params.get('min') === '5' ? 5 : 2;
  const total = min * 60;
  const [t, setT] = useState(0);
  const nav = useNavigate();
  const end = () => nav(kiosk ? '/kiosco/cierre' : '/', { replace: true });

  useEffect(() => {
    if (t >= total) return;
    const id = setTimeout(() => setT(t + 1), 1000);
    return () => clearTimeout(id);
  }, [t, total]);

  const rem = Math.max(0, total - t);
  const inhala = t % 10 < 4;
  const n = inhala ? 4 - (t % 10) : 10 - (t % 10);

  return (
    <div className="center-screen" style={{ gap: 32, padding: '32px 24px' }}>
      <div className="label cyan">RESPIRACIÓN GUIADA · {min} MIN</div>
      <div style={{ position: 'relative', width: 'min(80cqi, 340px)', aspectRatio: '1' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(255,255,255,.12)' }} />
        <div
          data-anim
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 45%, rgba(47,168,192,.55), rgba(93,1,88,.55) 60%, rgba(230,46,156,.25) 100%)',
            boxShadow: '0 0 80px rgba(47,168,192,.25)',
            animation: rem > 0 ? 'breathe 10s ease-in-out infinite' : 'none',
          }}
        />
        <h1 className="sr-only">Respiración guiada</h1>
        <div className="center-screen" style={{ position: 'absolute', inset: 0, gap: 4, padding: 0 }} aria-live="polite">
          <div className="display" style={{ fontSize: 32 }}>
            {rem > 0 ? (inhala ? 'Inhalá' : 'Exhalá') : 'Listo'}
          </div>
          {rem > 0 && (
            <div className="num muted" style={{ fontSize: 20 }}>
              {n}
            </div>
          )}
        </div>
      </div>
      <div className="num" style={{ fontSize: 28 }} aria-label="Tiempo restante">
        {Math.floor(rem / 60)}:{String(rem % 60).padStart(2, '0')}
      </div>
      <p className="muted" style={{ fontSize: 17, maxWidth: 360 }}>
        Seguí el círculo. Inhalá cuando crece, soltá el aire cuando se achica.
      </p>
      <button type="button" className="btn" style={{ padding: '0 28px' }} onClick={end}>
        Terminar
      </button>
    </div>
  );
}
