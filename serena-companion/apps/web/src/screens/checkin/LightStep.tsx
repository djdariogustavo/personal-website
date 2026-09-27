import { useEffect, useRef, useState } from 'react';
import { LIGHT_COPY, type LightAssessment, type ScanErrorCode } from '@serena/domain';
import { useApp, useOnline } from '../../lib/store.tsx';
import { LightMonitor, openFrontCamera, stopStream } from '../../lib/camera.ts';
import { getScanProvider, scanMode } from '../../scan/registry.ts';
import { Icon, Seal } from '../../components/ui.tsx';

type CamState = { kind: 'cargando' } | { kind: 'ok' } | { kind: 'error'; codigo: ScanErrorCode };

const COLORS = { insuficiente: ['#F37CC2', 'var(--alert-bg)'], justa: ['#F0CF7A', 'var(--warn-bg)'], optima: ['#7FD3E3', 'var(--ok-bg)'] } as const;

/**
 * 6.6 Paso 2: verificación de luz y encuadre. El escaneo NO puede empezar con
 * luz insuficiente. La luz se mide en el dispositivo (luminancia sobre el
 * óvalo + contraluz + sensor de luz ambiente si existe); el encuadre del
 * rostro lo informa el SDK por el evento `calidad`.
 */
export function LightStep({ onStream, onStart, onSkip, kiosk }: { onStream: (s: MediaStream | null) => void; onStart: () => void; onSkip: () => void; kiosk: boolean }) {
  const { config, session } = useApp();
  const online = useOnline();
  const [cam, setCam] = useState<CamState>({ kind: 'cargando' });
  const [light, setLight] = useState<LightAssessment | null>(null);
  const [rostro, setRostro] = useState<boolean | null>(null);
  const [tips, setTips] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const handedOff = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let monitor: LightMonitor | null = null;
    let cancelled = false;
    (async () => {
      const provider = await getScanProvider();
      const kind = kiosk ? 'kiosk' : (session?.deviceKind ?? 'mobile');
      if (!config.escaneo.disponibleEn[kind]) return setCam({ kind: 'error', codigo: 'no_soportado' });
      if (!online && !config.escaneo.offline) return setCam({ kind: 'error', codigo: 'sin_conexion' });
      const av = await provider.availability({ online });
      if (!av.disponible) return setCam({ kind: 'error', codigo: av.motivo ?? 'no_soportado' });
      const r = await openFrontCamera();
      if (cancelled) return 'error' in r ? undefined : stopStream(r.stream);
      if ('error' in r) return setCam({ kind: 'error', codigo: r.error });
      stream = r.stream;
      onStream(stream);
      setCam({ kind: 'ok' });
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      monitor = new LightMonitor(v, config.luz, setLight);
      monitor.start();
      await provider
        .mountPreview(slot.current!, stream, (e) => {
          if (e.type === 'calidad') setRostro(e.rostroCentrado);
        })
        .catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      monitor?.stop();
      if (!handedOff.current) {
        stopStream(stream);
        onStream(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const luz = light?.luz ?? 'justa';
  const copy = LIGHT_COPY[luz];
  const [fg, bg] = COLORS[luz];
  const dim = luz === 'insuficiente' ? 0.62 : luz === 'justa' ? 0.3 : 0;
  const measuring = cam.kind === 'ok' && !light;
  const checks: Array<[string, 'ok' | 'warn' | 'no' | 'na']> = [
    ['Luz suficiente', luz === 'optima' ? 'ok' : luz === 'justa' ? 'warn' : 'no'],
    ['Cara centrada', rostro === null ? 'na' : rostro ? 'ok' : 'no'],
    ['Sin movimiento', light?.movimiento ? 'no' : 'ok'],
    ['Sin contraluz', light?.contraluz ? 'no' : 'ok'],
  ];
  const mark = { ok: '✓', warn: '!', no: '×', na: '·' };
  const col = { ok: '#7FD3E3', warn: '#F0CF7A', no: '#F37CC2', na: '#9999B5' };
  const canStart = cam.kind === 'ok' && !!light && luz !== 'insuficiente';

  return (
    <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
      <div className="stack" style={{ flex: '1 1 320px', minWidth: 0, gap: 10 }}>
        <div className="camera">
          <div ref={slot} style={{ position: 'absolute', inset: 0 }} data-scan-slot="preview" />
          {cam.kind !== 'error' && (
            <>
              <video ref={video} muted playsInline aria-hidden="true" />
              <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: light ? dim : 0.4, transition: 'opacity .2s' }} />
              <div className="oval" style={{ ['--oval' as string]: light ? fg : '#9999B5' }} />
              <div className="checks">
                {checks.map(([l, s]) => (
                  <span key={l} style={{ color: col[s] }}>
                    {mark[s]} {l}
                  </span>
                ))}
              </div>
            </>
          )}
          {cam.kind === 'error' && (
            <div className="center-screen" style={{ position: 'absolute', inset: 0, gap: 16, padding: 32 }}>
              <Icon name="camOff" size={48} stroke="#9999B5" />
              <p style={{ fontSize: 17, maxWidth: 340 }}>{camMessage(cam.codigo)}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn btn-primary" style={{ minHeight: 48, fontSize: 15 }} onClick={onSkip}>
                  Check-in sin escaneo
                </button>
              </div>
            </div>
          )}
        </div>
        <Seal>EL VIDEO NO SE GUARDA · SE PROCESA EN ESTE DISPOSITIVO</Seal>
      </div>
      <div className="stack" style={{ flex: '1 1 300px', minWidth: 0, gap: 20 }}>
        <div className="row">
          <h1 className="h1" style={{ fontSize: 'clamp(26px, 3.6cqi, 36px)', lineHeight: 1.12 }}>
            Revisemos la luz
          </h1>
          {scanMode === 'simulado' && <span className="sim-chip">SIMULACIÓN · SIN SDK</span>}
        </div>
        {cam.kind === 'ok' && (
          <>
            <div className="stack" style={{ gap: 10 }}>
              <div className="meter" aria-hidden="true">
                {[1, 2, 3].map((i) => (
                  <div key={i} style={{ background: light && i <= copy.segmentos ? fg : undefined }} />
                ))}
              </div>
              <span className="chip" style={{ color: light ? fg : 'var(--c-meta)', background: light ? bg : 'var(--c-surface-2)' }} role="status">
                {measuring ? 'MIDIENDO LA LUZ…' : copy.etiqueta}
              </span>
            </div>
            <p style={{ fontSize: 18, lineHeight: 1.5 }}>{measuring ? 'Mirá a la cámara un momento.' : copy.mensaje}</p>
          </>
        )}
        <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, overflow: 'hidden' }}>
          <button
            type="button"
            aria-expanded={tips}
            onClick={() => setTips(!tips)}
            style={{ width: '100%', minHeight: 52, padding: '0 18px', border: 'none', background: 'var(--c-surface-1)', color: 'var(--c-text)', fontSize: 15, fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            {tips ? 'Ocultar consejos' : 'Ver consejos para medir mejor'}
            <span style={{ color: 'var(--c-cyan)' }}>{tips ? '−' : '＋'}</span>
          </button>
          {tips && (
            <div className="stack muted" style={{ padding: '4px 18px 16px', background: 'var(--c-surface-1)', gap: 10, fontSize: 15 }}>
              <div>Sacate el casco o las antiparras.</div>
              <div>Evitá tener una ventana detrás.</div>
              <div>Apoyá el dispositivo para que no se mueva.</div>
            </div>
          )}
        </div>
        <div className="actions">
          {cam.kind !== 'error' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canStart}
              onClick={() => {
                handedOff.current = true;
                onStart();
              }}
            >
              Empezar escaneo
            </button>
          )}
          {luz === 'justa' && canStart && <div className="warn-text">Podés empezar igual; la lectura puede ser menos precisa.</div>}
          <button type="button" className="btn-link" onClick={onSkip}>
            Prefiero saltear el escaneo
          </button>
        </div>
      </div>
    </div>
  );
}

function camMessage(c: ScanErrorCode): string {
  switch (c) {
    case 'sin_permiso':
      return 'Para el escaneo necesitamos la cámara. Podés habilitarla en ajustes o hacer el check-in sin escaneo.';
    case 'sin_camara':
      return 'No encontramos una cámara en este equipo. Podés hacer el check-in solo con autorreporte.';
    case 'sin_conexion':
      return 'Escaneo no disponible sin conexión. Podés hacer el check-in con autorreporte y reacción.';
    case 'sin_licencia':
    case 'no_soportado':
    default:
      return 'El escaneo todavía no está disponible en este equipo. Podés hacer el check-in solo con autorreporte.';
  }
}
