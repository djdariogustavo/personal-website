import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { EmergencyType } from '@serena/domain';
import { useApp, useOnline } from '../lib/store.tsx';
import { currentPosition, type EmergencyStatus } from '../lib/emergency.ts';
import { Icon, hhmm } from './ui.tsx';

/**
 * Botón de emergencia (6.13): hoja a pantalla completa, disponible desde
 * cualquier pantalla. Confirmación con "deslizar para enviar" (umbral 86 %)
 * para evitar toques accidentales; con teclado se usa el control como slider.
 */

const OPTIONS: Array<[EmergencyType, string, string]> = [
  ['fisica', 'Emergencia física', 'Accidente, lesión, gas, atrapamiento'],
  ['hablar', 'Necesito hablar con alguien', 'Una persona de guardia te contacta'],
  ['riesgo', 'Estoy en riesgo', 'Aviso prioritario a la guardia'],
];

export function EmergencySheet({ onClose, origen = 'boton', preset }: { onClose: () => void; origen?: 'boton' | 'acompanante'; preset?: EmergencyType }) {
  const { session, emergencies, config } = useApp();
  const online = useOnline();
  const [tipo, setTipo] = useState<EmergencyType | null>(preset ?? null);
  const [share, setShare] = useState(session?.perfil.consents.geo !== false);
  const [slide, setSlide] = useState(0);
  const [status, setStatus] = useState<EmergencyStatus | null>(null);
  const [sending, setSending] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const faena = session?.perfil.org.faena ?? '';
  const lineas = config.lineasAyuda[session?.perfil.org.pais ?? 'AR'];

  useEffect(() => {
    if (!emergencies) return;
    return emergencies.subscribe((s) => setStatus((cur) => (cur && cur.req.id === s.req.id ? s : cur)));
  }, [emergencies]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send() {
    if (!tipo || !emergencies || sending) return;
    setSending(true);
    const ubicacion = share ? await currentPosition() : null;
    const s = await emergencies.send({
      id: crypto.randomUUID(),
      tipo,
      compartirUbicacion: share,
      ubicacion,
      creadoEn: new Date().toISOString(),
      origen,
    });
    setStatus(s);
    setSending(false);
  }

  function frac(e: PointerEvent) {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left - 34) / (r.width - 68)));
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSlide(frac(e));
  };
  const move = (e: PointerEvent) => dragging.current && setSlide(frac(e));
  const up = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (slide > 0.86) {
      setSlide(1);
      void send();
    } else setSlide(0);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'End') {
      e.preventDefault();
      const n = e.key === 'End' ? 1 : Math.min(1, slide + 0.25);
      setSlide(n);
      if (n >= 1) void send();
    } else if (e.key === 'ArrowLeft' || e.key === 'Home') setSlide(0);
  };

  const hora = status ? hhmm(status.req.creadoEn) : '';

  return (
    <div className="overlay sheet-host" role="dialog" aria-modal="true" aria-labelledby="emerg-title">
      <div className="sheet">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label" style={{ color: '#0b0b1a' }}>
            AYUDA{faena ? ` · ${faena.toUpperCase()}` : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{ width: 48, height: 48, border: 'none', background: 'rgba(11,11,26,.12)', borderRadius: '50%', color: '#0b0b1a', fontSize: 22 }}
          >
            ×
          </button>
        </div>

        {!session && (
          <div className="stack" style={{ gap: 14 }}>
            <h2 id="emerg-title" className="display" style={{ fontSize: 30, lineHeight: 1.15 }}>
              ¿Necesitás ayuda ahora?
            </h2>
            <p style={{ fontSize: 18, fontWeight: 500 }}>Para avisar a la guardia desde la app, ingresá a tu cuenta. Si es urgente, avisá por radio o llamá:</p>
            {lineas.map((l) => (
              <a key={l.numero} href={`tel:${l.numero}`} className="opt" style={{ textDecoration: 'none' }}>
                <span className="display" style={{ fontSize: 20 }}>
                  {l.nombre} · {l.numero}
                </span>
              </a>
            ))}
          </div>
        )}

        {session && !status && (
          <div className="stack" style={{ gap: 14 }}>
            <h2 id="emerg-title" className="display" style={{ fontSize: 34, lineHeight: 1.1 }}>
              ¿Necesitás ayuda ahora?
            </h2>
            {OPTIONS.map(([k, l, d]) => (
              <button key={k} type="button" className="opt" aria-pressed={tipo === k} onClick={() => (setTipo(k), setSlide(0))}>
                <span className="display" style={{ fontSize: 20 }}>
                  {l}
                </span>
                <span style={{ fontSize: 14, color: '#b8b8cb' }}>{d}</span>
              </button>
            ))}
            <button
              type="button"
              role="switch"
              aria-checked={share}
              onClick={() => setShare(!share)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 56, padding: '0 4px', border: 'none', background: 'transparent', color: '#0b0b1a', fontSize: 16, fontWeight: 600, textAlign: 'left' }}
            >
              <span style={{ width: 48, height: 28, borderRadius: 999, background: share ? '#0b0b1a' : 'rgba(11,11,26,.25)', position: 'relative', display: 'block', flex: 'none' }}>
                <span style={{ position: 'absolute', top: 2, left: share ? 22 : 2, width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
              </span>
              Compartir mi ubicación con la guardia
            </button>
            {tipo && (
              <div
                ref={track}
                className="slide"
                role="slider"
                tabIndex={0}
                aria-label="Deslizá para enviar el aviso"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(slide * 100)}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onKeyDown={key}
              >
                <span className="hint" style={{ opacity: 1 - slide }}>
                  {sending ? 'Enviando…' : 'Deslizá para enviar el aviso'}
                </span>
                <span className="knob" style={{ left: `calc(4px + (100% - 68px) * ${slide})` }}>
                  <Icon name="send" size={24} stroke="#0B0B1A" width={2} />
                </span>
              </div>
            )}
          </div>
        )}

        {status && (
          <div className="stack" style={{ gap: 16 }} role="status">
            {status.estado === 'enviado' ? (
              <>
                <h2 id="emerg-title" className="display" style={{ fontSize: 30, lineHeight: 1.15 }}>
                  Aviso enviado a la guardia de {faena}. Quedate en línea.
                </h2>
                <div className="label" style={{ color: '#0b0b1a', fontSize: 13 }}>
                  {hora} · CANAL: {status.ack.canal}
                </div>
              </>
            ) : (
              <>
                <h2 id="emerg-title" className="display" style={{ fontSize: 30, lineHeight: 1.15 }}>
                  {status.motivo === 'sin_senal' ? 'Sin señal.' : 'Estamos enviando tu aviso.'}
                </h2>
                <p style={{ fontSize: 18, lineHeight: 1.5, fontWeight: 500 }}>
                  {status.motivo === 'sin_senal'
                    ? 'Guardamos el aviso y lo enviamos apenas haya conexión. Si podés, avisá por radio.'
                    : 'Lo reintentamos en unos segundos. Si podés, avisá también por radio.'}
                </p>
                <div className="label" style={{ color: '#0b0b1a', fontSize: 13 }}>
                  {hora} · EN COLA · SE REINTENTA CADA 10 S{online ? ' · REINTENTANDO' : ''}
                </div>
              </>
            )}
            <button type="button" onClick={onClose} style={{ minHeight: 56, border: 'none', borderRadius: 2, background: '#0b0b1a', color: '#fff', fontSize: 16, fontWeight: 600 }}>
              Volver
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
