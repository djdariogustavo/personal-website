import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { setForcedDevice, type Layout } from '../lib/device.ts';
import { useApp } from '../lib/store.tsx';
import { appLock } from '../lib/applock.ts';
import { asset } from './flags.ts';
import { resetDemo } from './mockApi.ts';

type Mode = 'mobile' | 'tablet' | 'desktop' | 'kiosk';
const SIZES: Record<Mode, [number, number] | null> = { mobile: [390, 844], tablet: [1194, 834], desktop: null, kiosk: [1080, 1920] };
const LABELS: Record<Mode, string> = { mobile: 'Teléfono', tablet: 'Tablet', desktop: 'Escritorio', kiosk: 'Kiosco' };
const BAR = 52;

function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

/**
 * Marco de la vista previa: barra con el selector de dispositivo, guía de
 * recorrido y reinicio. En pantallas chicas la app ocupa todo el ancho, como en
 * un teléfono real.
 */
export function DemoFrame({ children }: { children: ReactNode }) {
  const vp = useViewport();
  const narrow = vp.w < 700;
  const [mode, setMode] = useState<Mode>(narrow ? 'mobile' : 'mobile');
  const [guide, setGuide] = useState(true);
  const nav = useNavigate();
  const { endSession } = useApp();
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: vp.w, h: vp.h - BAR });

  useLayoutEffect(() => {
    if (narrow) setForcedDevice(null);
    else setForcedDevice({ layout: (mode === 'kiosk' ? 'tablet' : mode) as Layout, kiosk: mode === 'kiosk' });
  }, [mode, narrow]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function choose(m: Mode) {
    setMode(m);
    if (m === 'kiosk') nav('/kiosco');
    else if (mode === 'kiosk') nav('/');
  }

  async function reset() {
    await endSession({ remote: false });
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('serena.')) localStorage.removeItem(k);
    } catch {
      /* sin almacenamiento */
    }
    appLock.clear();
    resetDemo();
    setMode('mobile');
    nav('/bienvenida');
  }

  const size = narrow ? null : SIZES[mode];
  const pad = 24;
  const scale = size ? Math.min((stageSize.w - pad * 2) / size[0], (stageSize.h - pad * 2) / size[1], 1) : 1;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#06062a' }}>
      <div
        style={{
          height: BAR,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          borderBottom: '1px solid var(--c-line)',
          background: '#010147',
          overflowX: 'auto',
        }}
      >
        <img src={asset('serena-mark.png')} alt="" width={28} height={28} style={{ flex: 'none' }} />
        <div className="stack" style={{ gap: 0, minWidth: 0, flex: narrow ? '1 1 auto' : 'none', overflow: 'hidden' }}>
          <span className="display" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            Companion™ · Vista previa
          </span>
          <span className="label" style={{ fontSize: 9.5, whiteSpace: 'nowrap' }}>
            DATOS DE EJEMPLO · SIN SERVIDOR
          </span>
        </div>
        {!narrow && <div className="spacer" />}
        {!narrow && (
          <div role="radiogroup" aria-label="Dispositivo" style={{ display: 'flex', gap: 2, background: '#101052', padding: 3, borderRadius: 4, border: '1px solid var(--c-line)', flex: 'none' }}>
            {(Object.keys(LABELS) as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => choose(m)}
                style={{ height: 32, padding: '0 12px', border: 'none', borderRadius: 2, background: mode === m ? '#2FA8C0' : 'transparent', color: mode === m ? '#0B0B1A' : '#B8B8CB', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}
              >
                {LABELS[m]}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-data" style={{ minHeight: 36, padding: '0 12px', fontSize: 13, flex: 'none' }} aria-expanded={guide} onClick={() => setGuide(!guide)}>
          Guía
        </button>
        <button type="button" className="btn" style={{ minHeight: 36, padding: '0 12px', fontSize: 13, flex: 'none' }} onClick={() => void reset()}>
          Reiniciar
        </button>
      </div>
      <div ref={stage} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 0%, #14145a 0%, #06062a 70%)' }}>
        {size ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: size[0] * scale, height: size[1] * scale, position: 'relative', flex: 'none' }}>
              <div
                style={{
                  width: size[0],
                  height: size[1],
                  transform: `scale(${scale})`,
                  transformOrigin: '0 0',
                  position: 'absolute',
                  inset: 0,
                  borderRadius: mode === 'mobile' ? 40 : 16,
                  overflow: 'hidden',
                  boxShadow: '0 0 0 1px rgba(255,255,255,.14), 0 30px 80px rgba(0,0,0,.55)',
                }}
              >
                {/* translateZ crea un bloque contenedor: las hojas "fixed" quedan dentro del dispositivo. */}
                <div style={{ width: '100%', height: '100%', transform: 'translateZ(0)' }}>{children}</div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0, transform: 'translateZ(0)' }}>{children}</div>
        )}
        {guide && <Guide onClose={() => setGuide(false)} narrow={narrow} />}
      </div>
    </div>
  );
}

function Guide({ onClose, narrow }: { onClose: () => void; narrow: boolean }) {
  const steps: Array<[string, ReactNode]> = [
    ['Bienvenida e ingreso', <>Recorré la bienvenida y el consentimiento. Ingresá con usuario <b className="num">mrodriguez</b> y contraseña <b className="num">serena-demo</b>. El código de 6 dígitos aparece en pantalla.</>],
    ['PIN del teléfono', <>En la vista Teléfono la app pide crear un PIN: usá cualquier combinación de 4 dígitos.</>],
    ['Check-in', <>“Hacer mi check-in”. En “Revisemos la luz” podés simular luz insuficiente, justa u óptima: con luz insuficiente el escaneo no arranca.</>],
    ['Acompañante y Ayuda', <>Probá las respuestas rápidas del acompañante y el botón magenta “Ayuda”, con deslizar para enviar.</>],
    ['Kiosco', <>Elegí “Kiosco” arriba. Identificate con legajo <b className="num">04817</b> y PIN <b className="num">1234</b>. Al final la sesión se cierra sola a los 20 s.</>],
    ['Administración y pagos', <>En “Escritorio”, cerrá sesión e ingresá con <b className="num">admin</b> / <b className="num">serena-admin</b>. En Facturación contratá con la pasarela de prueba y mirá los reportes anónimos.</>],
  ];
  return (
    <aside
      aria-label="Guía de la vista previa"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        left: narrow ? 12 : 'auto',
        width: narrow ? 'auto' : 380,
        maxHeight: 'calc(100% - 24px)',
        overflow: 'auto',
        zIndex: 60,
        background: '#101052',
        border: '1px solid rgba(47,168,192,.45)',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        color: '#fff',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <span className="label cyan">GUÍA DE LA VISTA PREVIA</span>
        <button type="button" onClick={onClose} aria-label="Cerrar la guía" style={{ width: 36, height: 36, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 18 }}>
          ×
        </button>
      </div>
      <div className="display" style={{ fontSize: 20, lineHeight: 1.25 }}>
        SERENA Companion™
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        Preparada para la Dra. Karina Viñas, directora del proyecto. Es la app real con datos de ejemplo del brief (Matías R., Mina Los Andes, día 9 de 14 en turno noche).
      </p>
      <ol className="stack" style={{ gap: 12, margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.5 }}>
        {steps.map(([t, d]) => (
          <li key={t}>
            <div style={{ fontWeight: 600 }}>{t}</div>
            <div className="muted">{d}</div>
          </li>
        ))}
      </ol>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--warn-fg)', background: 'var(--warn-bg)', borderRadius: 8, padding: '10px 12px' }}>
        Simulado en esta vista previa: cámara y escaneo (valores no reales, el SDK todavía no está integrado), micrófono, avisos a la guardia, pagos y el acompañante (responde con frases fijas, sin el modelo de IA). Nada sale de este navegador.
      </div>
      <button type="button" className="btn btn-primary" style={{ minHeight: 44, fontSize: 15 }} onClick={onClose}>
        Empezar el recorrido
      </button>
    </aside>
  );
}
