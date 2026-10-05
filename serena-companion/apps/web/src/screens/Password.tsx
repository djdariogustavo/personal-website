import { asset } from '../demo/flags.ts';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PASSWORD_COPY, PASSWORD_MIN, validarPassword } from '@serena/domain';
import { api, ApiError, isOffline } from '../lib/api.ts';
import { useApp, type Profile } from '../lib/store.tsx';

/**
 * Contraseñas: recuperación por SMS (sin sesión), cambio voluntario y cambio
 * obligatorio tras una contraseña entregada por la empresa. La política es la
 * misma del servidor (packages/domain/src/password.ts); acá solo se avisa antes.
 */

function errMsg(e: unknown) {
  if (isOffline(e)) return 'Sin conexión. Probá cuando vuelva la señal.';
  if (e instanceof ApiError && e.mensaje) return e.mensaje;
  return 'No pudimos completar la acción. Probá de nuevo.';
}

/** Nueva contraseña + repetición, con el aviso de la política mientras se escribe. */
function NuevaPassword({ value, onChange, repetir, onRepetir, contexto }: { value: string; onChange: (v: string) => void; repetir: string; onRepetir: (v: string) => void; contexto: string[] }) {
  const problema = value ? validarPassword(value, contexto) : null;
  const distintas = repetir.length > 0 && repetir !== value;
  return (
    <>
      <label className="field">
        <span className="label">CONTRASEÑA NUEVA</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="pw-ayuda"
          aria-invalid={!!problema}
          required
        />
        <span id="pw-ayuda" className="meta" style={{ fontSize: 13, color: problema ? 'var(--warn-fg)' : undefined }}>
          {problema ? PASSWORD_COPY[problema] : `Al menos ${PASSWORD_MIN} caracteres. Probá con una frase: “mate cocido en la garita”.`}
        </span>
      </label>
      <label className="field">
        <span className="label">REPETILA</span>
        <input className="input" type="password" autoComplete="new-password" value={repetir} onChange={(e) => onRepetir(e.target.value)} aria-invalid={distintas} required />
        {distintas && (
          <span className="meta" style={{ fontSize: 13, color: 'var(--warn-fg)' }}>
            No coinciden.
          </span>
        )}
      </label>
    </>
  );
}

const lista = (value: string, repetir: string, contexto: string[]) => !validarPassword(value, contexto) && value === repetir;

/** "¿Olvidaste tu contraseña?" — código por SMS al teléfono registrado. */
export function Recover() {
  const nav = useNavigate();
  const [step, setStep] = useState<'ident' | 'codigo' | 'listo'>('ident');
  const [ident, setIdent] = useState('');
  const [challenge, setChallenge] = useState<{ challengeId: string; venceEnMin: number; codigoDesarrollo?: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // El servidor también rechaza datos personales; acá solo se conoce lo que la persona escribió.
  const contexto = [ident];

  async function start(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setChallenge(await api('/auth/recover/start', { body: { identificador: ident } }));
      setCodigo('');
      setStep('codigo');
    } catch (er) {
      setError(errMsg(er));
    } finally {
      setBusy(false);
    }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/recover/finish', { body: { challengeId: challenge.challengeId, codigo, nueva } });
      setStep('listo');
    } catch (er) {
      setError(errMsg(er));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scroll">
      <div className="screen" style={{ maxWidth: 460, flex: 1, justifyContent: 'center' }}>
        <img src={asset('serena-mark.png')} alt="" width={72} height={72} />
        {step === 'ident' && (
          <form className="stack" style={{ gap: 20 }} onSubmit={start}>
            <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1 }}>
              Recuperá tu contraseña
            </h1>
            <p className="muted">Te mandamos un código por SMS al teléfono registrado en tu cuenta.</p>
            <label className="field">
              <span className="label">USUARIO CORPORATIVO O DNI</span>
              <input className="input" value={ident} onChange={(e) => setIdent(e.target.value)} autoComplete="username" required minLength={3} />
            </label>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Enviar código
            </button>
            <p className="meta" style={{ fontSize: 14, textAlign: 'center' }}>
              <Link to="/ingresar">Volver al ingreso</Link>
            </p>
          </form>
        )}

        {step === 'codigo' && challenge && (
          <form className="stack" style={{ gap: 20 }} onSubmit={finish}>
            <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1 }}>
              Elegí una contraseña nueva
            </h1>
            {/* Mismo texto exista o no la cuenta: no se revela quién usa SERENA. */}
            <p className="muted">
              Si los datos corresponden a una cuenta con teléfono registrado, te llegó un SMS con un código de 6 dígitos. Vence en {challenge.venceEnMin} minutos.
            </p>
            {challenge.codigoDesarrollo && <div className="notice">Modo desarrollo · código: {challenge.codigoDesarrollo}</div>}
            <label className="field">
              <span className="label">CÓDIGO DEL SMS</span>
              <input
                className="input num"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                required
              />
            </label>
            <NuevaPassword value={nueva} onChange={setNueva} repetir={repetir} onRepetir={setRepetir} contexto={contexto} />
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || codigo.length !== 6 || !lista(nueva, repetir, contexto)}>
              Guardar contraseña
            </button>
            <p className="meta" style={{ fontSize: 14, lineHeight: 1.5 }}>
              ¿No te llegó? <button type="button" className="linklike" onClick={() => void start()} disabled={busy}>Pedí otro código</button>. Si cambiaste de teléfono o no tenés uno registrado,
              pedí a salud ocupacional de tu faena que restablezca tu contraseña.
            </p>
          </form>
        )}

        {step === 'listo' && (
          <div className="stack" style={{ gap: 20 }} role="status">
            <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1 }}>
              Listo, ya podés ingresar
            </h1>
            <p className="muted">Por seguridad cerramos tu sesión en todos los dispositivos. Te enviamos un SMS avisando del cambio.</p>
            <button type="button" className="btn btn-primary" onClick={() => nav('/ingresar', { replace: true })}>
              Ir al ingreso
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Cambio de contraseña con sesión. `obligatorio`: la entregó la empresa y hay que cambiarla para seguir. */
export function ChangePassword({ obligatorio = false }: { obligatorio?: boolean }) {
  const { session, setProfile } = useApp();
  const nav = useNavigate();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = session!.perfil;
  const contexto = [p.nombre, p.nombreCorto];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ perfil: Profile; sesionesCerradas: number }>('/me/password', { body: { actual, nueva } });
      setActual('');
      setNueva('');
      setRepetir('');
      if (obligatorio) {
        setProfile(r.perfil);
        nav(p.role === 'admin' ? '/admin' : '/', { replace: true });
        return;
      }
      setOk(
        r.sesionesCerradas > 0
          ? `Listo. Cerramos tu sesión en ${r.sesionesCerradas} dispositivo${r.sesionesCerradas === 1 ? '' : 's'} más; en este seguís adentro.`
          : 'Listo. Tu contraseña se cambió.',
      );
    } catch (er) {
      setError(errMsg(er));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ maxWidth: 520 }}>
      {obligatorio ? (
        <>
          <div className="label cyan">ANTES DE EMPEZAR</div>
          <h1 className="h1">Elegí tu contraseña</h1>
          <p className="muted">
            La contraseña que te dieron es temporal. Elegí una propia: nadie más la va a conocer, ni tu empresa. Si necesitás ayuda ahora, el botón Ayuda funciona igual.
          </p>
        </>
      ) : (
        <>
          <div className="label cyan">SEGURIDAD</div>
          <h1 className="h1">Cambiar contraseña</h1>
          <p className="muted">Al cambiarla cerramos tu sesión en los demás dispositivos y te avisamos por SMS.</p>
        </>
      )}
      <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
        <label className="field">
          <span className="label">{obligatorio ? 'CONTRASEÑA TEMPORAL' : 'CONTRASEÑA ACTUAL'}</span>
          <input className="input" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} required />
        </label>
        <NuevaPassword value={nueva} onChange={setNueva} repetir={repetir} onRepetir={setRepetir} contexto={contexto} />
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {ok && (
          <div className="notice" role="status">
            {ok}
          </div>
        )}
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy || !actual || !lista(nueva, repetir, contexto)}>
            {busy ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </div>
      </form>
    </div>
  );
}
