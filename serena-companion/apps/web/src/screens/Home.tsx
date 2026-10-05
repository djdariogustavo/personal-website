import { useNavigate } from 'react-router';
import { fmt, LEVEL_COPY, rosterChip, rosterStatus, saludo } from '@serena/domain';
import { useApp, useCheckins } from '../lib/store.tsx';
import { LevelChip, whenLabel } from '../components/ui.tsx';

/** 6.4 Hoy. Cambia de mensaje cuando la persona está en su descanso. */
export function Home() {
  const { session } = useApp();
  const checkins = useCheckins();
  const nav = useNavigate();
  if (!session) return null;
  const p = session.perfil;
  const st = rosterStatus(p.roster);
  const last = checkins[0];
  const since = Date.now() - 9 * 86_400_000;
  const recent = checkins.filter((c) => Date.parse(c.createdAt) >= since);
  const days = new Set(recent.map((c) => new Date(c.createdAt).toDateString())).size;

  const lastCard = (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="label">ÚLTIMO RESULTADO</div>
        {last && <LevelChip level={last.nivel}>NIVEL {LEVEL_COPY[last.nivel].historial.toUpperCase()}</LevelChip>}
      </div>
      {last ? (
        <>
          {last.escaneo ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="num" style={{ fontSize: 40 }}>
                {fmt(last.escaneo.metricas.estres, 1)}
              </span>
              <span className="muted" style={{ fontSize: 15 }}>
                índice de estrés, de 5
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 17, fontWeight: 500 }}>Check-in con autorreporte</div>
          )}
          <div className="muted" style={{ fontSize: 15 }}>
            {whenLabel(last.createdAt)} · {last.deviceName}
          </div>
        </>
      ) : (
        <div className="muted">Todavía no hiciste ningún check-in. Cuando quieras, es un minuto.</div>
      )}
      <div className="row" style={{ justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--c-line)' }}>
        <span style={{ fontSize: 15 }}>
          {days} check-in{days === 1 ? '' : 's'} en los últimos 9 días
        </span>
        <button type="button" className="btn-text" onClick={() => nav('/bienestar')}>
          Ver mi historial
        </button>
      </div>
    </div>
  );

  if (!st.enTurno)
    return (
      <div className="screen">
        <div className="stack">
          <h1 className="h1">Bienvenido a casa. Tu cuerpo también necesita volver.</h1>
          <span className="chip chip-neutral">{rosterChip(st, p.roster.turno)}</span>
        </div>
        <div className="grid" style={{ ['--min' as string]: '260px' }}>
          <button type="button" className="card" style={{ textAlign: 'left', minHeight: 180, justifyContent: 'space-between', background: 'linear-gradient(160deg,#5D0158 0%,#20205D 100%)', color: '#fff' }} onClick={() => nav('/recursos/volver-a-casa')}>
            <span className="label" style={{ color: '#F37CC2' }}>
              DESCONEXIÓN · 6 MIN
            </span>
            <span className="display" style={{ fontSize: 22, lineHeight: 1.2 }}>
              Volver a casa después del roster
            </span>
          </button>
          <button type="button" className="card" style={{ textAlign: 'left', minHeight: 180, justifyContent: 'space-between', color: 'var(--c-text)' }} onClick={() => nav('/recursos/dormir-turno-noche')}>
            <span className="label cyan">SUEÑO · 4 LECTURAS</span>
            <span className="display" style={{ fontSize: 22, lineHeight: 1.2 }}>
              Recuperar el ritmo de día
            </span>
          </button>
          <button type="button" className="card" style={{ textAlign: 'left', minHeight: 180, justifyContent: 'space-between', color: 'var(--c-text)' }} onClick={() => nav('/recursos/volver-a-casa#reencuentro')}>
            <span className="label cyan">FAMILIA · 5 MIN</span>
            <span className="display" style={{ fontSize: 22, lineHeight: 1.2 }}>
              El reencuentro, sin apuro
            </span>
          </button>
        </div>
        <div className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="stack" style={{ gap: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 17 }}>¿Querés hacer un check-in desde casa?</div>
            <div className="muted" style={{ fontSize: 15 }}>
              Voluntario. Lo ves también en tu teléfono.
            </div>
          </div>
          <button type="button" className="btn" onClick={() => nav('/checkin')}>
            Hacer mi check-in
          </button>
        </div>
        {lastCard}
      </div>
    );

  return (
    <div className="screen">
      <div className="stack">
        <h1 className="h1">
          {saludo()}, {p.nombreCorto}.
        </h1>
        <span className="chip chip-ok">{rosterChip(st, p.roster.turno)}</span>
      </div>
      <div className="grid" style={{ ['--min' as string]: '320px' }}>
        <div className="card hero" style={{ gap: 18 }}>
          <div className="display" style={{ fontSize: 'clamp(24px, 3cqi, 32px)', lineHeight: 1.15 }}>
            ¿Cómo estás hoy?
          </div>
          <button type="button" className="btn btn-primary" onClick={() => nav('/checkin')}>
            Hacer mi check-in
          </button>
          <div className="muted" style={{ fontSize: 15 }}>
            Menos de un minuto · Voluntario
          </div>
        </div>
        {lastCard}
      </div>
      <div className="stack">
        <div className="label">ACCESOS RÁPIDOS</div>
        <div className="grid" style={{ ['--min' as string]: '220px', gap: 12 }}>
          <button type="button" className="quick" onClick={() => nav('/respirar?min=2')}>
            <span>Respirar 2 minutos</span>
            <span className="label">2 MIN</span>
          </button>
          <button type="button" className="quick" onClick={() => nav('/recursos/dormir-turno-noche')}>
            <span>Dormir mejor en turno noche</span>
            <span className="label">4 LECT.</span>
          </button>
          <button type="button" className="quick" onClick={() => nav('/acompanante')}>
            <span>Hablar con el acompañante</span>
            <span className="label">24/7</span>
          </button>
        </div>
      </div>
    </div>
  );
}
