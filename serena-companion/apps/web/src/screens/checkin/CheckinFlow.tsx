import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { classify, rosterStatus, type CheckIn, type MoodIndex, type ReactionResult, type ScanResult, type SleepIndex, type VoiceResult } from '@serena/domain';
import { useApp } from '../../lib/store.tsx';
import { stopStream } from '../../lib/camera.ts';
import { StepProgress } from '../../components/ui.tsx';
import { MoodStep } from './MoodStep.tsx';
import { LightStep } from './LightStep.tsx';
import { ScanStep } from './ScanStep.tsx';
import { ReactionStep } from './ReactionStep.tsx';

type Step = 0 | 1 | 2 | 3;

/**
 * Check-in en 4 pasos (6.5–6.8). Si un permiso está apagado, el paso
 * correspondiente se omite. Todo se calcula y se guarda primero en el
 * dispositivo; la sincronización sube el registro cuando hay conexión.
 */
export function CheckinFlow({ kiosk = false }: { kiosk?: boolean }) {
  const { session, engine, config } = useApp();
  const nav = useNavigate();
  const consents = session?.perfil.consents;
  const enabled = {
    animo: consents?.animo !== false,
    escaneo: consents?.camara !== false,
    reaccion: consents?.reaccion !== false,
  };
  const firstStep: Step = enabled.animo ? 0 : enabled.escaneo ? 1 : 3;
  const [step, setStep] = useState<Step>(firstStep);
  const [animo, setAnimo] = useState<MoodIndex | null>(null);
  const [sueno, setSueno] = useState<SleepIndex | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const saving = useRef(false);

  useEffect(() => () => stopStream(stream.current), []);

  async function finish(extra: { escaneo?: ScanResult | null; reaccion?: ReactionResult | null; voz?: VoiceResult | null }) {
    if (!session || !engine || saving.current) return;
    saving.current = true;
    stopStream(stream.current);
    stream.current = null;
    const now = new Date();
    const st = rosterStatus(session.perfil.roster, now);
    const escaneo = extra.escaneo !== undefined ? extra.escaneo : scan;
    const reaccion = extra.reaccion ?? null;
    const c: CheckIn = {
      id: crypto.randomUUID(),
      userId: session.perfil.id,
      deviceId: session.deviceId,
      deviceName: kiosk ? 'Kiosco' : deviceLabel(session.deviceKind),
      deviceKind: session.deviceKind,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      rosterDay: st.enTurno ? st.dia : null,
      onShift: st.enTurno,
      animo: enabled.animo ? animo : null,
      sueno: enabled.animo ? sueno : null,
      escaneo,
      reaccion,
      voz: extra.voz ?? null,
      nivel: 'bajo',
      nota: null,
    };
    c.nivel = classify(c, config.niveles);
    await engine.saveCheckin(c);
    nav(`${kiosk ? '/kiosco' : ''}/resultado/${c.id}`, { replace: true });
  }

  if (!enabled.animo && !enabled.escaneo && !enabled.reaccion)
    return (
      <div className="screen narrow">
        <h1 className="h1">El check-in está pausado</h1>
        <p className="muted">Apagaste todos los permisos del check-in. Podés volver a activarlos cuando quieras en Privacidad.</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => nav('/privacidad')}>
            Ir a Privacidad
          </button>
        </div>
      </div>
    );

  const skipScan = () => void finish({ escaneo: null });

  return (
    <div className={step === 2 ? 'bg-grid' : ''} style={{ flex: 1, minHeight: '100%' }}>
      <div className="screen" style={step === 2 ? { alignItems: 'center' } : undefined}>
        <StepProgress current={step} />
        {step === 0 && (
          <MoodStep
            animo={animo}
            sueno={sueno}
            setAnimo={setAnimo}
            setSueno={setSueno}
            onNext={() => {
              if (enabled.escaneo) setStep(1);
              else if (enabled.reaccion) setStep(3);
              else void finish({});
            }}
            onSkipScan={skipScan}
            allowScan={enabled.escaneo}
          />
        )}
        {step === 1 && (
          <LightStep
            onStream={(s) => (stream.current = s)}
            onStart={() => setStep(2)}
            onSkip={skipScan}
            kiosk={kiosk}
          />
        )}
        {step === 2 && (
          <ScanStep
            stream={stream.current}
            duracionS={config.escaneo.duracionS}
            onDone={(r) => {
              setScan(r);
              stopStream(stream.current);
              stream.current = null;
              if (enabled.reaccion) setStep(3);
              else void finish({ escaneo: r });
            }}
            onAbort={skipScan}
          />
        )}
        {step === 3 && <ReactionStep kiosk={kiosk} onDone={(reaccion, voz) => void finish({ reaccion, voz })} />}
      </div>
    </div>
  );
}

function deviceLabel(kind: string) {
  return kind === 'mobile' ? 'Teléfono' : kind === 'tablet' ? 'Tablet' : kind === 'kiosk' ? 'Kiosco' : 'Computadora';
}
