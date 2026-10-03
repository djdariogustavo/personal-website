import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { fmt, LEVEL_COPY, type CheckIn } from '@serena/domain';
import { useApp } from '../lib/store.tsx';
import { useEmergency } from '../components/AppShell.tsx';
import { Icon, LevelChip, Ring } from '../components/ui.tsx';
import type { EmergencyStatus } from '../lib/emergency.ts';

/** 6.9 Resultado (bajo / moderado / alto). El lenguaje es amable y nunca diagnóstico. */
export function Result({ kiosk = false }: { kiosk?: boolean }) {
  const { id } = useParams();
  const { engine } = useApp();
  const [c, setC] = useState<CheckIn | null | undefined>(undefined);
  const nav = useNavigate();

  useEffect(() => {
    if (!engine || !id) return;
    void engine.db.get<CheckIn>('checkins', id).then((x) => setC(x ?? null));
  }, [engine, id]);

  if (c === undefined) return null;
  if (c === null)
    return (
      <div className="screen narrow">
        <p className="muted">No encontramos este registro.</p>
        <button type="button" className="btn" onClick={() => nav(kiosk ? '/kiosco/cierre' : '/')}>
          Volver
        </button>
      </div>
    );

  const end = () => nav(kiosk ? '/kiosco/cierre' : '/', { replace: true });
  const vals = c.escaneo
    ? ([
        ['FRECUENCIA CARDÍACA', fmt(c.escaneo.metricas.pulso), 'lpm'],
        ['VARIABILIDAD (HRV)', fmt(c.escaneo.metricas.hrv), 'ms'],
        ['RESPIRACIÓN', fmt(c.escaneo.metricas.respiracion), 'rpm'],
        ['ÍNDICE DE ESTRÉS', fmt(c.escaneo.metricas.estres, 1), 'de 5'],
      ] as const)
    : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="screen result" style={{ flex: 1 }}>
        <div className="stack" style={{ gap: 14 }}>
          <LevelChip level={c.nivel}>{LEVEL_COPY[c.nivel].chip}</LevelChip>
          <h1 className="h1" style={{ fontSize: 'clamp(30px, 4.6cqi, 48px)' }}>
            {LEVEL_COPY[c.nivel].titulo}
          </h1>
        </div>
        {c.nivel === 'alto' ? (
          <HighLevel kiosk={kiosk} onDone={end} />
        ) : (
          <>
            {vals && (
              <div className="grid" style={{ ['--min' as string]: '150px', gap: 10 }}>
                {vals.map(([l, v, u]) => (
                  <div key={l} className="value-card big">
                    <div className="label" style={{ fontSize: 10.5 }}>
                      {l}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span className="v">{v}</span>
                      <span className="muted" style={{ fontSize: 14 }}>
                        {u}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {c.nivel === 'bajo' ? <LowActions c={c} onDone={end} kiosk={kiosk} /> : <ModerateActions kiosk={kiosk} />}
          </>
        )}
      </div>
      <div className="sticky-foot label">
        <Icon name="lock" size={14} />
        TU EMPRESA NO VE ESTE RESULTADO
      </div>
    </div>
  );
}

function LowActions({ c, onDone, kiosk }: { c: CheckIn; onDone: () => void; kiosk: boolean }) {
  const { engine } = useApp();
  const [note, setNote] = useState('');
  return (
    <>
      {!kiosk && (
        <div className="card" style={{ padding: 20 }}>
          <label htmlFor="nota" style={{ fontSize: 16 }}>
            ¿Querés dejar un registro de cómo te sentís?
          </label>
          <input id="nota" className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Opcional · solo lo ves vos" />
        </div>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            if (note.trim() && engine) await engine.saveCheckin({ ...c, nota: note.trim(), updatedAt: new Date().toISOString() });
            onDone();
          }}
        >
          Listo
        </button>
      </div>
    </>
  );
}

function ModerateActions({ kiosk }: { kiosk: boolean }) {
  const nav = useNavigate();
  return (
    <>
      <div className="actions wide">
        <button type="button" className="btn btn-primary" onClick={() => nav(kiosk ? '/kiosco/respirar?min=2' : '/respirar?min=2')}>
          Hacer una respiración guiada de 2 minutos
        </button>
        {!kiosk ? (
          <button type="button" className="btn" onClick={() => nav('/acompanante')}>
            Contarle al acompañante
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => nav('/kiosco/cierre')}>
            Terminar
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 15 }}>
        Te propongo otro check-in al final del turno.
      </p>
    </>
  );
}

/**
 * Nivel alto: pantalla de acompañamiento, no de alarma. Cuenta de 15 s que
 * conecta con la guardia salvo que la persona elija otra opción. Solo la
 * guardia recibe el aviso, nunca el supervisor.
 */
function HighLevel({ kiosk, onDone }: { kiosk: boolean; onDone: () => void }) {
  const { config, emergencies, session } = useApp();
  const openEmergency = useEmergency();
  const total = config.resultadoAlto.cuentaS;
  const [t, setT] = useState(total);
  const [state, setState] = useState<'contando' | 'conectando' | 'rechazado'>('contando');
  const [status, setStatus] = useState<EmergencyStatus | null>(null);
  const sent = useRef(false);
  const lineas = config.lineasAyuda[session?.perfil.org.pais ?? 'AR'];

  async function connect() {
    if (sent.current || !emergencies) return;
    sent.current = true;
    setState('conectando');
    const s = await emergencies.send({
      id: crypto.randomUUID(),
      tipo: 'riesgo',
      compartirUbicacion: false,
      ubicacion: null,
      creadoEn: new Date().toISOString(),
      origen: 'resultado_alto',
    });
    setStatus(s);
  }

  useEffect(() => {
    if (state !== 'contando') return;
    if (t <= 0) {
      void connect();
      return;
    }
    const id = setTimeout(() => setT(t - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, state]);

  useEffect(() => {
    if (!emergencies) return;
    return emergencies.subscribe((s) => setStatus((cur) => (cur && cur.req.id === s.req.id ? s : cur)));
  }, [emergencies]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <p className="muted" style={{ fontSize: 18, maxWidth: 620 }}>
        Vamos a conectarte con la guardia de tu faena. Solo ellos reciben este aviso, no tu supervisor.
      </p>
      <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: '16px 20px' }} role="status" aria-live="polite">
        {state === 'contando' && (
          <>
            <Ring size={52} r={22} stroke={3} progress={t / total}>
              {t}
            </Ring>
            <div style={{ fontSize: 16, lineHeight: 1.45 }}>Te conectamos con la guardia en {t} s, salvo que elijas otra opción.</div>
          </>
        )}
        {state === 'conectando' && (
          <div style={{ fontSize: 16, lineHeight: 1.45, color: 'var(--ok-fg)' }}>
            {status?.estado === 'en_cola'
              ? status.motivo === 'sin_senal'
                ? 'Sin señal: el aviso a la guardia quedó en cola y se envía apenas haya conexión. Si podés, avisá por radio.'
                : 'Estamos enviando el aviso a la guardia; lo reintentamos en unos segundos. Si podés, avisá también por radio.'
              : `Conectando con la guardia de ${session?.perfil.org.faena}. Quedate en línea.`}
          </div>
        )}
        {state === 'rechazado' && (
          <div style={{ fontSize: 16, lineHeight: 1.45 }}>Está bien. Cuando quieras, la guardia sigue disponible. Te dejamos las líneas de ayuda acá abajo.</div>
        )}
      </div>
      <div className="actions wide">
        <button type="button" className="btn btn-primary" disabled={state === 'conectando'} onClick={() => void connect()}>
          Conectarme ahora
        </button>
        {state === 'contando' && (
          <button type="button" className="btn" onClick={() => setState('rechazado')}>
            Ahora no, prefiero hablar con alguien de confianza
          </button>
        )}
        {state === 'rechazado' && !kiosk && (
          <button type="button" className="btn" onClick={() => openEmergency({ tipo: 'hablar' })}>
            Pedir que alguien me contacte
          </button>
        )}
        {state !== 'contando' && (
          <button type="button" className="btn-link" onClick={onDone}>
            Volver al inicio
          </button>
        )}
      </div>
      <div className="stack" style={{ gap: 6, padding: '16px 20px', border: '1px solid rgba(230,46,156,.4)', borderRadius: 12 }}>
        <div className="label" style={{ color: 'var(--alert-fg)', fontSize: 11 }}>
          LÍNEA DE EMERGENCIA · SIEMPRE DISPONIBLE
        </div>
        <div style={{ fontSize: 16 }}>
          {lineas.map((l, i) => (
            <span key={l.numero}>
              {i > 0 && ' · '}
              {l.nombre}{' '}
              <a href={`tel:${l.numero}`}>
                <strong className="num">{l.numero}</strong>
              </a>
            </span>
          ))}{' '}
          · {config.guardia.radio}
        </div>
      </div>
    </div>
  );
}
