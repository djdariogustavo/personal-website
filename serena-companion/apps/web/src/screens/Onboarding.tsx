import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DEFAULT_CONSENTS, type Consents } from '@serena/domain';
import { useApp, storage } from '../lib/store.tsx';
import { Toggle } from '../components/ui.tsx';

const SLIDES: Array<[string, string, string]> = [
  ['01 / 03', 'Esto es tuyo.', 'Tus resultados son solo tuyos. Tu empresa nunca ve tus datos individuales.'],
  ['02 / 03', 'Es voluntario.', 'Hacés el check-in cuando querés. No hacerlo no tiene ninguna consecuencia.'],
  ['03 / 03', 'No estás solo.', 'Si algo no anda bien, te ayudamos a llegar a quien puede ayudarte.'],
];

/** 6.1 Splash y bienvenida. */
export function Splash() {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const done = () => {
    storage.set('serena.welcomed', true);
    nav('/consentimiento');
  };
  return (
    <main className="scroll bg-splash">
      <div className="center-screen" style={{ gap: 40 }}>
        {i === 0 ? (
          <div className="stack" style={{ alignItems: 'center', gap: 36, width: '100%', maxWidth: 640 }}>
            <img
              src="/assets/serena-logo-white.png"
              alt="SERENA · Sistema de Equilibrio, Recreación y Neuro-Bienestar Avanzado"
              style={{ width: '100%', maxWidth: 560, height: 'auto' }}
            />
            <p className="display" style={{ fontSize: 'clamp(24px, 4cqi, 38px)', lineHeight: 1.2, textWrap: 'balance' }}>
              Un minuto para vos, en medio del turno.
            </p>
            <button type="button" className="btn btn-primary" style={{ padding: '0 40px' }} onClick={() => setI(1)}>
              Empezar
            </button>
            <div className="label" style={{ color: 'var(--c-text-2)', fontSize: 11 }}>
              SERENA COMPANION™ · TECNOLOGÍA ROBOTA TECHNOLOGIES
            </div>
          </div>
        ) : (
          <div className="stack" style={{ alignItems: 'center', gap: 28, width: '100%', maxWidth: 560 }}>
            <img src="/assets/serena-mark.png" alt="" width={120} height={120} />
            <div className="label cyan">{SLIDES[i - 1]![0]}</div>
            <h1 className="display" style={{ fontSize: 'clamp(34px, 6cqi, 56px)', lineHeight: 1.05 }}>
              {SLIDES[i - 1]![1]}
            </h1>
            <p className="muted" style={{ fontSize: 18, textWrap: 'pretty' }}>
              {SLIDES[i - 1]![2]}
            </p>
            <div style={{ display: 'flex', gap: 8 }} aria-hidden="true">
              {[1, 2, 3].map((k) => (
                <span key={k} style={{ height: 8, width: k === i ? 28 : 8, borderRadius: 999, background: k === i ? '#E62E9C' : 'rgba(255,255,255,.25)', transition: 'all .2s' }} />
              ))}
            </div>
            <div className="actions" style={{ maxWidth: 360 }}>
              <button type="button" className="btn btn-primary" onClick={() => (i < 3 ? setI(i + 1) : done())}>
                Siguiente
              </button>
              <button type="button" className="btn-link" style={{ textDecoration: 'none' }} onClick={done}>
                Saltear
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export const CONSENT_ITEMS: Array<[keyof Consents, string, string]> = [
  ['camara', 'Lectura fisiológica por cámara (NeuroSentinel™)', 'La cámara mide tu pulso y respiración. El video se procesa en tu dispositivo y se descarta. No se guarda tu cara.'],
  ['animo', 'Autorreporte de ánimo y fatiga', 'Dos preguntas cortas sobre cómo llegás. Podés saltearlas.'],
  ['reaccion', 'Prueba de reacción y voz', 'Diez toques y una frase en voz alta para ver tu nivel de alerta.'],
  ['chat', 'Conversación con el acompañante', 'Tus conversaciones se guardan cifradas y solo vos podés verlas.'],
  ['geo', 'Geolocalización', 'Solo al usar el botón de emergencia, para que la guardia te encuentre.'],
];

/** 6.2 Consentimiento informado, granular y revocable. */
export function ConsentScreen() {
  const { pendingConsents, setPendingConsents, config } = useApp();
  const [c, setC] = useState<Consents>(pendingConsents ?? DEFAULT_CONSENTS);
  const nav = useNavigate();
  return (
    <main className="scroll">
      <div className="screen narrow">
        <div className="stack">
          <div className="label cyan">CONSENTIMIENTO INFORMADO</div>
          <h1 className="h1" style={{ fontSize: 'clamp(28px, 4.4cqi, 42px)' }}>
            Vos elegís qué se usa.
          </h1>
          <p className="muted">Cada permiso es independiente. Si apagás uno, el resto sigue funcionando.</p>
        </div>
        <div className="list">
          {CONSENT_ITEMS.map(([k, label, desc]) => (
            <div key={k} className="list-row" style={{ alignItems: 'flex-start', padding: '18px 20px', gap: 16 }}>
              <div className="stack" style={{ flex: 1, gap: 6, minWidth: 0 }}>
                <div style={{ fontWeight: 600, lineHeight: 1.35 }}>{label}</div>
                <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.5 }}>
                  {desc}
                </div>
              </div>
              <Toggle checked={c[k]} label={label} onChange={(v) => setC({ ...c, [k]: v })} />
            </div>
          ))}
        </div>
        <a href={config.politicaUrl} target="_blank" rel="noreferrer" style={{ fontSize: 15 }}>
          Leer la política completa
        </a>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setPendingConsents(c);
            nav('/ingresar');
          }}
        >
          Acepto y continúo
        </button>
        <p className="meta" style={{ fontSize: 14, textAlign: 'center' }}>
          Podés cambiar esto cuando quieras en Privacidad.
        </p>
      </div>
    </main>
  );
}
