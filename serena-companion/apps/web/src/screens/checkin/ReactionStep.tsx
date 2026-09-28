import { DEMO } from '../../demo/flags.ts';
import { useEffect, useRef, useState } from 'react';
import type { ReactionResult, VoiceResult } from '@serena/domain';

const TOQUES = 10;

/**
 * 6.8 Paso 4: prueba de reacción (10 toques, el círculo aparece tras una
 * espera aleatoria en una posición al azar) y lectura en voz alta. El audio se
 * analiza en vivo solo para dibujar la onda y medir duración y volumen: nunca
 * se graba ni se envía. Ambas pruebas se pueden saltear.
 */
export function ReactionStep({ onDone }: { kiosk: boolean; onDone: (r: ReactionResult | null, v: VoiceResult | null) => void }) {
  const [reaction, setReaction] = useState<ReactionResult | null>(null);
  const [reactSkipped, setReactSkipped] = useState(false);
  const [voice, setVoice] = useState<VoiceResult | null>(null);

  return (
    <>
      <h1 className="h1" style={{ fontSize: 'clamp(26px, 3.6cqi, 36px)', lineHeight: 1.12 }}>
        Dos pruebas cortas
      </h1>
      <div className="grid" style={{ ['--min' as string]: '340px' }}>
        <ReactionTest done={reaction} skipped={reactSkipped} onResult={setReaction} onSkip={() => setReactSkipped(true)} />
        <VoiceTest onResult={setVoice} />
      </div>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => onDone(reaction, voice)}>
          Ver mi resultado
        </button>
      </div>
    </>
  );
}

function ReactionTest({ done, skipped, onResult, onSkip }: { done: ReactionResult | null; skipped: boolean; onResult: (r: ReactionResult) => void; onSkip: () => void }) {
  const [n, setN] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const shownAt = useRef(0);
  const times = useRef<number[]>([]);
  const early = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [started, setStarted] = useState(false);

  const schedule = () => {
    setPos(null);
    const wait = 700 + Math.random() * 1300;
    timer.current = setTimeout(() => {
      setPos({ x: 12 + Math.random() * 76, y: 14 + Math.random() * 72 });
      shownAt.current = performance.now();
    }, wait);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Con teclado (WCAG 2.1.1): Espacio o Enter equivalen a tocar el círculo; antes de que aparezca
  // cuentan como anticipados, igual que un toque. Con lector de pantalla se anuncia "Ahora".
  useEffect(() => {
    if (!started || done || skipped) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      if ((e.target as HTMLElement | null)?.closest('button, a, input, textarea, select') && !(e.target as HTMLElement).classList.contains('react-dot')) return;
      e.preventDefault();
      if (e.repeat) return;
      if (pos) hit();
      else early.current++;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const hit = () => {
    if (!pos) return;
    times.current.push(performance.now() - shownAt.current);
    const next = n + 1;
    setN(next);
    if (next >= TOQUES) {
      setPos(null);
      const sorted = [...times.current].sort((a, b) => a - b);
      // Media recortada: descarta el más rápido y el más lento (toques accidentales).
      const trimmed = sorted.length > 4 ? sorted.slice(1, -1) : sorted;
      onResult({ toques: next, mediaMs: Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length), anticipados: early.current });
    } else schedule();
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600, fontSize: 17 }}>Reacción</div>
        <span className="label cyan">
          {n} / {TOQUES}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 15 }}>
        Tocá el círculo apenas aparezca. Con teclado, apretá Espacio.
      </div>
      <div className="sr-only" aria-live="assertive">
        {started && !done && !skipped && pos ? 'Ahora' : ''}
      </div>
      <div
        className="react-area"
        onPointerDown={(e) => {
          if (started && !pos && !done && e.target === e.currentTarget) early.current++;
        }}
      >
        {done ? (
          <div className="center-screen" style={{ position: 'absolute', inset: 0, gap: 6, padding: 0 }}>
            <div className="num" style={{ fontSize: 30 }}>
              {done.mediaMs} ms
            </div>
            <div className="muted" style={{ fontSize: 14 }}>
              Tiempo medio de reacción
            </div>
          </div>
        ) : skipped ? (
          <div className="center-screen muted" style={{ position: 'absolute', inset: 0, padding: 0 }}>
            Prueba salteada
          </div>
        ) : !started ? (
          <div className="center-screen" style={{ position: 'absolute', inset: 0, padding: 0 }}>
            <button type="button" className="btn btn-data" onClick={() => (setStarted(true), schedule())}>
              Empezar
            </button>
          </div>
        ) : (
          pos && <button type="button" className="react-dot" aria-label="Círculo" tabIndex={-1} style={{ left: `${pos.x}%`, top: `${pos.y}%` }} onPointerDown={hit} />
        )}
      </div>
      {!done && !skipped && (
        <button
          type="button"
          className="btn-link"
          style={{ alignSelf: 'flex-start', padding: 0 }}
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            setPos(null);
            onSkip();
          }}
        >
          Saltear
        </button>
      )}
    </div>
  );
}

function VoiceTest({ onResult }: { onResult: (v: VoiceResult | null) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'done' | 'skip' | 'error'>('idle');
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 32 }, (_, i) => 0.15 + ((Math.sin(i * 1.7) + 1) / 2) * 0.25));
  const cleanup = useRef<() => void>(() => {});
  const stats = useRef({ start: 0, sum: 0, n: 0 });

  useEffect(() => () => cleanup.current(), []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 128;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const time = new Uint8Array(an.fftSize);
      stats.current = { start: performance.now(), sum: 0, n: 0 };
      let raf = 0;
      const loop = () => {
        an.getByteFrequencyData(buf);
        an.getByteTimeDomainData(time);
        let s = 0;
        for (const v of time) s += ((v - 128) / 128) ** 2;
        stats.current.sum += Math.sqrt(s / time.length);
        stats.current.n++;
        setLevels(Array.from({ length: 32 }, (_, i) => Math.max(0.12, (buf[Math.min(buf.length - 1, i + 2)] ?? 0) / 255)));
        raf = requestAnimationFrame(loop);
      };
      loop();
      cleanup.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      };
      setState('rec');
    } catch {
      if (DEMO) {
        // Vista previa: sin micrófono en el marco, se simula la onda.
        stats.current = { start: performance.now(), sum: 0, n: 0 };
        const id = setInterval(() => {
          stats.current.sum += 0.2;
          stats.current.n++;
          setLevels(Array.from({ length: 32 }, () => 0.15 + Math.random() * 0.85));
        }, 90);
        cleanup.current = () => clearInterval(id);
        setState('rec');
        return;
      }
      setState('error');
    }
  }

  function stop() {
    cleanup.current();
    const { start, sum, n } = stats.current;
    const r: VoiceResult = { duracionS: Math.round((performance.now() - start) / 100) / 10, nivelMedio: n ? Math.min(1, Math.round((sum / n) * 1000) / 1000) : 0 };
    onResult(r);
    setState('done');
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 17 }}>Voz</div>
      <div className="muted" style={{ fontSize: 15 }}>
        Leé en voz alta:
      </div>
      <div className="display" style={{ fontSize: 22, lineHeight: 1.3 }}>
        “Hoy es un buen día para volver a casa sano.”
      </div>
      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-well)', borderRadius: 8 }}>
        <div className={`wave ${state === 'rec' ? 'on' : ''}`} aria-hidden="true">
          {levels.map((l, i) => (
            <span key={i} style={{ transform: `scaleY(${l})` }} />
          ))}
        </div>
      </div>
      {state === 'error' && <div className="warn-text">No pudimos usar el micrófono. Podés saltear esta prueba.</div>}
      {state === 'done' && <div className="notice">Listo. El audio no se guarda.</div>}
      {state === 'skip' && <div className="muted">Prueba salteada</div>}
      {(state === 'idle' || state === 'rec' || state === 'error') && (
        <div className="row">
          {state !== 'error' && (
            <button type="button" className="btn btn-data" style={{ minHeight: 48, fontSize: 15 }} onClick={state === 'rec' ? stop : start}>
              {state === 'rec' ? 'Detener' : 'Grabar la frase'}
            </button>
          )}
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              cleanup.current();
              onResult(null);
              setState('skip');
            }}
          >
            Saltear
          </button>
        </div>
      )}
    </div>
  );
}
