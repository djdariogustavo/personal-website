import { MOOD_OPTIONS, SLEEP_OPTIONS, type MoodIndex, type SleepIndex } from '@serena/domain';

/** 6.5 Paso 1: autorreporte con palabras, sin números ni caras. */
export function MoodStep(p: {
  animo: MoodIndex | null;
  sueno: SleepIndex | null;
  setAnimo: (v: MoodIndex) => void;
  setSueno: (v: SleepIndex) => void;
  onNext: () => void;
  onSkipScan: () => void;
  allowScan: boolean;
}) {
  return (
    <>
      <fieldset className="stack" style={{ gap: 16, border: 0, padding: 0, margin: 0 }}>
        <legend className="h1" style={{ fontSize: 'clamp(26px, 4cqi, 40px)', lineHeight: 1.12, marginBottom: 16 }}>
          ¿Cómo llegás a este momento del turno?
        </legend>
        <div className="grid" style={{ ['--min' as string]: '150px', gap: 10 }} role="radiogroup">
          {MOOD_OPTIONS.map((l, i) => (
            <button key={l} type="button" role="radio" className="choice" aria-checked={p.animo === i} onClick={() => p.setAnimo(i as MoodIndex)}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="stack" style={{ gap: 16, border: 0, padding: 0, margin: 0 }}>
        <legend className="h2" style={{ marginBottom: 16 }}>
          ¿Cuánto dormiste en tu último descanso?
        </legend>
        <div className="grid" style={{ ['--min' as string]: '140px', gap: 10 }} role="radiogroup">
          {SLEEP_OPTIONS.map((l, i) => (
            <button key={l} type="button" role="radio" className="choice" style={{ textAlign: 'center', fontSize: 16 }} aria-checked={p.sueno === i} onClick={() => p.setSueno(i as SleepIndex)}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={p.onNext}>
          Siguiente
        </button>
        {p.allowScan && (
          <button type="button" className="btn-link" onClick={p.onSkipScan}>
            Prefiero saltear el escaneo
          </button>
        )}
      </div>
    </>
  );
}
