import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../lib/store.tsx';
import { appLock } from '../lib/applock.ts';
import { PinDots, PinPad } from './ui.tsx';

/** "Cerramos tu sesión por inactividad." (§7) y otros cierres de sesión. */
export function SessionEndedOverlay() {
  const { sessionEnded, clearSessionEnded, config, session } = useApp();
  const nav = useNavigate();
  if (!sessionEnded || session) return null;
  const inact = sessionEnded === 'sesion_inactividad';
  const kind = (JSON.parse(localStorage.getItem('serena.lastKind') ?? '"desktop"') as 'mobile' | 'tablet' | 'desktop' | 'kiosk') ?? 'desktop';
  return (
    <div className="overlay" style={{ zIndex: 30, background: 'rgba(1,1,71,.94)' }} role="dialog" aria-modal="true">
      <div className="stack" style={{ maxWidth: 440, gap: 18, alignItems: 'center', textAlign: 'center' }}>
        <img src="/assets/serena-mark.png" alt="" width={72} height={72} />
        <h2 className="display" style={{ fontSize: 28, lineHeight: 1.15 }}>
          {inact ? 'Cerramos tu sesión por inactividad.' : 'Tu sesión se cerró.'}
        </h2>
        <p className="muted">
          {inact
            ? `Pasaron ${config.sesion.inactividadMin[kind]} minutos sin uso. Lo hacemos para cuidar tu privacidad. Tu registro está a salvo.`
            : 'La sesión se cerró desde otro dispositivo o venció. Tu registro está a salvo.'}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '0 32px' }}
          onClick={() => {
            clearSessionEnded();
            nav('/ingresar');
          }}
        >
          Volver a ingresar
        </button>
      </div>
    </div>
  );
}

/** Desbloqueo local del teléfono: PIN de 4 dígitos o huella (6.3). */
export function LockScreen() {
  const { session, unlock, endSession } = useApp();
  const nav = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bio, setBio] = useState(false);

  useEffect(() => {
    setBio(appLock.hasBiometric());
  }, []);

  useEffect(() => {
    if (pin.length < 4) return;
    void appLock.verify(pin).then((r) => {
      if (r === 'ok') unlock();
      else if (r === 'bloqueado') void endSession({ reason: 'sesion_bloqueada' }).then(() => nav('/ingresar'));
      else {
        setError('El PIN no coincide. Probá de nuevo.');
        setPin('');
      }
    });
  }, [pin, unlock, endSession, nav]);

  return (
    <div className="overlay" style={{ zIndex: 35, background: 'var(--c-bg)' }} role="dialog" aria-modal="true" aria-label="Desbloquear">
      <div className="stack" style={{ gap: 24, alignItems: 'center', textAlign: 'center' }}>
        <img src="/assets/serena-mark.png" alt="" width={72} height={72} />
        <h1 className="display" style={{ fontSize: 28, lineHeight: 1.1 }}>
          Hola de nuevo, {session?.perfil.nombreCorto}.
        </h1>
        <p className="muted">Ingresá tu PIN de 4 dígitos{bio ? ' o usá tu huella' : ''}.</p>
        <PinDots n={pin.length} />
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <PinPad
          onDigit={(d) => setPin((p) => (p.length < 4 ? p + d : p))}
          onDelete={() => setPin((p) => p.slice(0, -1))}
          extra={bio ? { label: 'Huella', onClick: () => void appLock.unlockBiometric().then((ok) => ok && unlock()) } : null}
        />
        <button type="button" className="btn-link" onClick={() => void endSession().then(() => nav('/ingresar'))}>
          Ingresar con mi contraseña
        </button>
      </div>
    </div>
  );
}
