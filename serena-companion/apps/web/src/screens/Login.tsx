import { asset } from '../demo/flags.ts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, isOffline } from '../lib/api.ts';
import { useApp, storage, type Profile, type Session } from '../lib/store.tsx';
import { defaultDeviceName, describeSystem, detectDeviceKind } from '../lib/device.ts';
import { appLock } from '../lib/applock.ts';
import { PinDots, PinPad } from '../components/ui.tsx';

interface LoginOk {
  paso: 'listo';
  token: string;
  deviceId: string;
  trustToken?: string;
  perfil: Profile;
}
interface Login2fa {
  paso: 'segundo_factor';
  challengeId: string;
  telefonoTermina: string | null;
  codigoDesarrollo?: string;
}

/** 6.3 Ingreso seguro. */
export function Login() {
  const { startSession, setProfile, pendingConsents, setPendingConsents, session } = useApp();
  const nav = useNavigate();
  const kind = detectDeviceKind();
  const trust = storage.get<{ token: string; deviceId: string }>('serena.trust');
  const device = { kind, nombre: defaultDeviceName(kind), sistema: describeSystem(), id: trust?.deviceId ?? null };

  const [step, setStep] = useState<'cred' | '2fa' | 'pin'>(session && kind === 'mobile' && !appLock.configured() ? 'pin' : 'cred');
  const [ident, setIdent] = useState('');
  const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(false);
  const [challenge, setChallenge] = useState<Login2fa | null>(null);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const retenidos = storage.get<{ n: number }>('serena.retenidos');
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  async function finish(r: LoginOk) {
    const s: Session = { token: r.token, deviceId: r.deviceId, deviceKind: kind, efimera: false, perfil: r.perfil, trustToken: r.trustToken };
    await startSession(s);
    // Consentimiento elegido antes de ingresar (6.2): se aplica ahora.
    if (pendingConsents) {
      try {
        const res = await api<{ perfil: Profile }>('/consents', { method: 'PUT', body: pendingConsents });
        setProfile(res.perfil);
        setPendingConsents(null);
      } catch {
        /* se reintenta desde Privacidad */
      }
    }
    if (r.perfil.role === 'admin') return nav('/admin', { replace: true });
    if (kind === 'mobile' && !appLock.configured()) return setStep('pin');
    nav('/', { replace: true });
  }

  function fail(e: unknown) {
    if (isOffline(e)) setError('Sin conexión. Para ingresar la primera vez necesitás señal.');
    else if (e instanceof ApiError) setError(e.mensaje || 'No pudimos ingresar. Probá de nuevo.');
    else setError('No pudimos ingresar. Probá de nuevo.');
  }

  async function submitCred(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<LoginOk | Login2fa>('/auth/login', {
        body: { identificador: ident, password: pass, device, trustToken: trust?.token ?? null },
      });
      if (r.paso === 'listo') return await finish(r);
      setChallenge(r);
      setCode(['', '', '', '', '', '']);
      setStep('2fa');
      if (r.codigoDesarrollo) setInfo(`Modo desarrollo: el código es ${r.codigoDesarrollo}.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(ev?: FormEvent) {
    ev?.preventDefault();
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api<LoginOk>('/auth/verify', { body: { challengeId: challenge.challengeId, codigo: code.join(''), recordar: remember, device } });
      await finish(r);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!challenge) return;
    try {
      const r = await api<{ codigoDesarrollo?: string }>('/auth/resend', { body: { challengeId: challenge.challengeId } });
      setError(null);
      setInfo(r.codigoDesarrollo ? `Te mandamos un código nuevo. Modo desarrollo: ${r.codigoDesarrollo}.` : 'Te mandamos un código nuevo.');
    } catch (e) {
      fail(e);
    }
  }

  function setDigit(i: number, v: string) {
    const digits = v.replace(/\D/g, '');
    if (digits.length > 1) {
      // Pegado del código completo.
      const next = digits.slice(0, 6).split('');
      setCode([...next, ...Array(6 - next.length).fill('')]);
      codeRefs.current[Math.min(5, next.length)]?.focus();
      return;
    }
    const next = [...code];
    next[i] = digits;
    setCode(next);
    if (digits && i < 5) codeRefs.current[i + 1]?.focus();
  }

  useEffect(() => {
    if (step === '2fa' && code.every((d) => d)) void submitCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <main className="scroll">
      <div className="screen" style={{ maxWidth: 460, flex: 1, justifyContent: 'center' }}>
        <img src={asset('serena-mark.png')} alt="" width={72} height={72} />

        {step === 'cred' && (
          <form className="stack" style={{ gap: 20 }} onSubmit={submitCred}>
            <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1 }}>
              Ingresá a tu cuenta
            </h1>
            {retenidos && (
              <div className="notice" role="status">
                Hay {retenidos.n} registro{retenidos.n === 1 ? '' : 's'} de una sesión anterior guardado{retenidos.n === 1 ? '' : 's'} en este equipo, cifrado{retenidos.n === 1 ? '' : 's'}. Se suben cuando esa persona vuelva a ingresar acá.
              </div>
            )}
            <label className="field">
              <span className="label">USUARIO CORPORATIVO O DNI</span>
              <input className="input" value={ident} onChange={(e) => setIdent(e.target.value)} autoComplete="username" inputMode="text" required />
            </label>
            <label className="field">
              <span className="label">CONTRASEÑA</span>
              <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required />
            </label>
            {kind === 'desktop' && (
              <button
                type="button"
                role="checkbox"
                aria-checked={remember}
                onClick={() => setRemember(!remember)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, border: 'none', background: 'transparent', color: 'var(--c-text-2)', fontSize: 15, padding: 0, textAlign: 'left' }}
              >
                <span style={{ width: 22, height: 22, border: '1.5px solid #2FA8C0', borderRadius: 2, background: remember ? '#2FA8C0' : 'transparent', flex: 'none' }} />
                Recordar este dispositivo por 30 días
              </button>
            )}
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Ingresar
            </button>
            <p className="meta" style={{ fontSize: 14, textAlign: 'center' }}>
              ¿Olvidaste tu contraseña? Pedí una nueva a salud ocupacional de tu faena.
            </p>
          </form>
        )}

        {step === '2fa' && (
          <form className="stack" style={{ gap: 20 }} onSubmit={submitCode}>
            <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1 }}>
              Confirmá que sos vos
            </h1>
            <p className="muted">
              Te mandamos un código de 6 dígitos{challenge?.telefonoTermina ? ` al teléfono terminado en ${challenge.telefonoTermina}` : ''}.
            </p>
            <div className={`code-grid ${error ? 'err' : ''}`}>
              {code.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    codeRefs.current[i] = el;
                  }}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => e.key === 'Backspace' && !d && i > 0 && codeRefs.current[i - 1]?.focus()}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  aria-label={`Dígito ${i + 1}`}
                  autoFocus={i === 0}
                />
              ))}
            </div>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            {info && !error && <div className="notice">{info}</div>}
            <button type="submit" className="btn btn-primary" disabled={busy || code.some((x) => !x)}>
              Verificar
            </button>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn-text" onClick={resend}>
                Pedir un código nuevo
              </button>
              <button type="button" className="btn-text" onClick={() => (setStep('cred'), setError(null))}>
                Volver
              </button>
            </div>
          </form>
        )}

        {step === 'pin' && <PinSetup onDone={() => nav('/', { replace: true })} />}
      </div>
    </main>
  );
}

/** Primer ingreso en el teléfono: crear el PIN de 4 dígitos y, si se puede, activar la huella. */
function PinSetup({ onDone }: { onDone: () => void }) {
  const { session } = useApp();
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [askBio, setAskBio] = useState(false);

  useEffect(() => {
    if (pin.length < 4) return;
    if (!first) {
      setFirst(pin);
      setPin('');
      return;
    }
    if (pin !== first) {
      setError('Los PIN no coinciden. Empezá de nuevo.');
      setFirst(null);
      setPin('');
      return;
    }
    void appLock.setPin(pin).then(async () => {
      if (await appLock.biometricAvailable()) setAskBio(true);
      else onDone();
    });
  }, [pin, first, onDone]);

  if (askBio)
    return (
      <div className="stack" style={{ gap: 20, textAlign: 'center', alignItems: 'center' }}>
        <h1 className="display" style={{ fontSize: 28 }}>
          ¿Querés abrir la app con tu huella?
        </h1>
        <p className="muted">Usa el desbloqueo de tu teléfono. La huella nunca sale del dispositivo.</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => void appLock.enrollBiometric(session!.perfil.id, session!.perfil.nombreCorto).finally(onDone)}>
            Activar huella
          </button>
          <button type="button" className="btn-link" onClick={onDone}>
            Ahora no
          </button>
        </div>
      </div>
    );

  return (
    <div className="stack" style={{ gap: 24, alignItems: 'center', textAlign: 'center' }}>
      <h1 className="display" style={{ fontSize: 28, lineHeight: 1.1 }}>
        {first ? 'Repetí tu PIN' : 'Creá un PIN para abrir la app'}
      </h1>
      <p className="muted">4 dígitos. Solo se guarda en este teléfono.</p>
      <PinDots n={pin.length} />
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <PinPad onDigit={(d) => (setError(null), setPin((p) => (p.length < 4 ? p + d : p)))} onDelete={() => setPin((p) => p.slice(0, -1))} />
    </div>
  );
}
