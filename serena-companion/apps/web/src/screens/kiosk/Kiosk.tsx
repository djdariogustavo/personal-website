import { DEMO } from '../../demo/flags.ts';
import { asset } from '../../demo/flags.ts';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, isOffline } from '../../lib/api.ts';
import { useApp, storage, type Profile } from '../../lib/store.tsx';
import { openFrontCamera, stopStream } from '../../lib/camera.ts';
import { PinDots, PinPad, Ring } from '../../components/ui.tsx';

/**
 * 6.16 Modo kiosco (tablet fija en acceso o comedor). Sesión efímera: todo
 * vive en memoria y al cerrar no queda nada del trabajador en el equipo.
 */

const KIOSK_KEY = 'serena.kiosk.token';

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function KioskWait() {
  const now = useClock();
  const nav = useNavigate();
  const { session, endSession } = useApp();
  // En la vista previa el equipo ya está registrado como kiosco.
  const token = storage.get<string>(KIOSK_KEY) ?? (DEMO ? 'kiosco-demo-vista-previa' : null);

  // Si quedó una sesión abierta, se cierra al volver a la espera.
  useEffect(() => {
    if (session?.efimera) void endSession();
  }, [session, endSession]);

  if (!token) return <KioskSetup />;
  return (
    <div className="bg-splash" style={{ flex: 1, minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: 'clamp(40px, 8cqi, 96px) clamp(24px, 6cqi, 72px)', textAlign: 'center', gap: 40 }}>
      <img src={asset('serena-logo-white.png')} alt="SERENA" style={{ width: 640, maxWidth: '100%', height: 'auto' }} />
      <div className="stack" style={{ alignItems: 'center', gap: 20 }}>
        <div className="kiosk-clock">{now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
        <div className="label" style={{ fontSize: 22, color: 'var(--c-text-2)' }}>
          {now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
        </div>
      </div>
      <div className="stack" style={{ alignItems: 'center', gap: 32, width: '100%' }}>
        <div className="display" style={{ fontSize: 'clamp(28px, 4cqi, 40px)', lineHeight: 1.25 }}>
          Check-in de bienestar
          <br />
          <span style={{ color: 'var(--c-text-2)', fontWeight: 600 }}>Voluntario · Confidencial</span>
        </div>
        <button type="button" className="kiosk-start" onClick={() => nav('/kiosco/id')}>
          Empezar
        </button>
        <div className="label" style={{ fontSize: 16 }}>
          NADA QUEDA GUARDADO EN ESTA PANTALLA
        </div>
      </div>
    </div>
  );
}

/** Registro inicial del equipo como kiosco (lo hace salud ocupacional con el token del panel de administración). */
function KioskSetup() {
  const [t, setT] = useState('');
  const [done, setDone] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    if (done) nav('/kiosco/id');
  }, [done, nav]);
  return (
    <div className="screen narrow" style={{ justifyContent: 'center', flex: 1 }}>
      <h1 className="h1">Este equipo no está registrado como kiosco</h1>
      <p className="muted">Pedile a salud ocupacional el código del kiosco. Se genera en Administración › Equipo y kioscos.</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (t.trim().length < 20) return;
          storage.set(KIOSK_KEY, t.trim());
          setDone(true);
        }}
      >
        <label className="field">
          <span className="label">CÓDIGO DEL KIOSCO</span>
          <input className="input" value={t} onChange={(e) => setT(e.target.value)} autoComplete="off" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={t.trim().length < 20}>
          Registrar este equipo
        </button>
      </form>
    </div>
  );
}

interface KioskLogin {
  token: string;
  deviceId: string;
  perfil: Profile;
}

export function KioskId() {
  const { startSession } = useApp();
  const nav = useNavigate();
  const [mode, setMode] = useState<'qr' | 'legajo'>('qr');
  const [legajo, setLegajo] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function login(body: { legajo?: string; pin?: string; qr?: string }) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<KioskLogin>('/auth/kiosk', { body: { kioskToken: storage.get<string>(KIOSK_KEY), ...body } });
      await startSession({ token: r.token, deviceId: r.deviceId, deviceKind: 'kiosk', efimera: true, perfil: r.perfil });
      nav('/kiosco/checkin', { replace: true });
    } catch (e) {
      setPin('');
      setError(isOffline(e) ? 'Sin conexión. El kiosco necesita señal para identificarte.' : e instanceof ApiError && e.mensaje ? e.mensaje : 'No pudimos identificarte.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ flex: 1, alignItems: 'center', gap: 40, padding: 'clamp(32px, 6cqi, 72px)' }}>
      <h1 className="display" style={{ fontSize: 'clamp(40px, 5cqi, 56px)', textAlign: 'center' }}>
        ¿Quién sos?
      </h1>
      <div className="row" style={{ gap: 8, width: '100%', maxWidth: 760, flexWrap: 'nowrap' }}>
        <button type="button" className="kiosk-tab" aria-pressed={mode === 'qr'} onClick={() => setMode('qr')}>
          QR de la credencial
        </button>
        <button type="button" className="kiosk-tab" aria-pressed={mode === 'legajo'} onClick={() => setMode('legajo')}>
          Legajo + PIN
        </button>
      </div>
      {error && (
        <div className="alert" role="alert" style={{ fontSize: 20, maxWidth: 760, width: '100%' }}>
          {error}
        </div>
      )}
      {mode === 'qr' ? (
        <QrReader onCode={(qr) => void login({ qr })} busy={busy} />
      ) : (
        <div className="stack" style={{ alignItems: 'center', gap: 32, width: '100%', maxWidth: 560 }}>
          <label className="field" style={{ width: '100%' }}>
            <span className="label" style={{ fontSize: 18 }}>
              LEGAJO
            </span>
            <input className="input num" style={{ height: 88, fontSize: 32 }} value={legajo} onChange={(e) => setLegajo(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="off" />
          </label>
          <PinDots n={pin.length} />
          <PinPad onDigit={(d) => setPin((p) => (p.length < 4 ? p + d : p))} onDelete={() => setPin((p) => p.slice(0, -1))} />
          <button type="button" className="btn btn-primary btn-block" style={{ height: 112, fontSize: 32 }} disabled={pin.length < 4 || !legajo || busy} onClick={() => void login({ legajo, pin })}>
            Continuar
          </button>
        </div>
      )}
      <button type="button" className="btn" style={{ minHeight: 72, fontSize: 20, padding: '0 36px' }} onClick={() => nav('/kiosco')}>
        Cancelar
      </button>
    </div>
  );
}

interface BarcodeDetectorLike {
  detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

/** Lectura del QR con la cámara (BarcodeDetector, si el navegador lo trae) o ingreso manual del código. */
function QrReader({ onCode, busy }: { onCode: (c: string) => void; busy: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [manual, setManual] = useState('');
  const found = useRef(false);

  useEffect(() => {
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    if (!BD) return setSupported(false);
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    void openFrontCamera().then((r) => {
      if (!alive || 'error' in r) return setSupported(false);
      stream = r.stream;
      setSupported(true);
      const v = video.current!;
      v.srcObject = stream;
      void v.play();
      const det = new BD({ formats: ['qr_code'] });
      timer = setInterval(async () => {
        if (found.current || v.readyState < 2) return;
        const codes = await det.detect(v).catch(() => []);
        if (codes[0]?.rawValue) {
          found.current = true;
          onCode(codes[0].rawValue);
          setTimeout(() => (found.current = false), 3000);
        }
      }, 400);
    });
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      stopStream(stream);
    };
  }, [onCode]);

  return (
    <div className="stack" style={{ alignItems: 'center', gap: 32, width: '100%', maxWidth: 560 }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%,#20205D,#0b0b2e)' }}>
        {supported && <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />}
        <div style={{ position: 'absolute', inset: '14%', border: '3px solid var(--c-cyan)', borderRadius: 12 }} />
      </div>
      {supported !== false ? (
        <div style={{ fontSize: 28 }} className="muted">
          {busy ? 'Verificando…' : 'Acercá tu credencial a la cámara.'}
        </div>
      ) : (
        <form
          className="stack"
          style={{ width: '100%' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onCode(manual.trim());
          }}
        >
          <label className="field">
            <span className="label" style={{ fontSize: 18 }}>
              CÓDIGO DE LA CREDENCIAL (LECTOR O TECLADO)
            </span>
            <input className="input" style={{ height: 88, fontSize: 28 }} value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" autoFocus />
          </label>
          <button type="submit" className="btn btn-primary" style={{ height: 88, fontSize: 26 }} disabled={!manual.trim() || busy}>
            Continuar
          </button>
        </form>
      )}
    </div>
  );
}

/** Cierre con cuenta regresiva de 20 s y cierre de sesión automático. Nada queda en pantalla. */
export function KioskClose() {
  const { session, endSession, config, engine } = useApp();
  const nav = useNavigate();
  const total = config.sesion.kioscoCierreS;
  const [t, setT] = useState(total);
  const nombre = useRef(session?.perfil.nombreCorto ?? '');
  // El registro tiene que subir antes de cerrar: el kiosco no conserva nada.
  const [subido, setSubido] = useState<boolean | null>(null);
  useEffect(() => {
    if (!engine) return;
    void engine.sync().then(() => setSubido(engine.getSnapshot().pendientes === 0));
  }, [engine]);

  const close = async () => {
    await endSession();
    nav('/kiosco', { replace: true });
  };

  useEffect(() => {
    if (t <= 0) {
      void close();
      return;
    }
    const id = setTimeout(() => setT(t - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  return (
    <div className="center-screen" style={{ gap: 56, padding: 'clamp(32px, 6cqi, 72px)' }}>
      <div style={{ width: 180, height: 180, borderRadius: '50%', background: 'rgba(47,168,192,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#7FD3E3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h1 className="display" style={{ fontSize: 'clamp(40px, 6cqi, 64px)', lineHeight: 1.15, textWrap: 'balance' }}>
        {subido === false
          ? 'Sin señal: no pudimos subir tu registro.'
          : `Listo${nombre.current ? `, ${nombre.current}` : ''}. Tu registro ya está en tu teléfono.`}
      </h1>
      {subido === false && (
        <p className="muted" style={{ fontSize: 22, maxWidth: 760 }}>
          Por privacidad, este equipo no guarda datos de nadie. Si querés, repetí el check-in desde tu teléfono.
        </p>
      )}
      <div className="row" style={{ gap: 28, justifyContent: 'center', flexWrap: 'nowrap' }}>
        <Ring size={128} r={54} stroke={6} progress={t / total}>
          <span style={{ fontSize: 44 }}>{t}</span>
        </Ring>
        <div className="muted" style={{ fontSize: 28, textAlign: 'left', lineHeight: 1.4 }}>
          Cerramos tu sesión
          <br />
          automáticamente.
        </div>
      </div>
      <button type="button" className="btn" style={{ height: 112, padding: '0 64px', fontSize: 30 }} onClick={() => void close()}>
        Cerrar ahora
      </button>
      <div className="label" style={{ fontSize: 16 }}>
        NADA QUEDA EN ESTA PANTALLA
      </div>
    </div>
  );
}
