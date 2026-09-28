import { useEffect, useState } from 'react';
import type { Consents } from '@serena/domain';
import { api, ApiError, isOffline } from '../lib/api.ts';
import { Link } from 'react-router';
import { useApp, type Profile } from '../lib/store.tsx';
import { CONSENT_ITEMS } from './Onboarding.tsx';
import { downloadMyData } from './Wellbeing.tsx';
import { Icon, Toggle } from '../components/ui.tsx';

/** 6.14 Privacidad y datos. */
export function Privacy() {
  const { session, setProfile, engine } = useApp();
  const [confirm, setConfirm] = useState<'borrar' | 'retirar' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shared, setShared] = useState<number | null>(null);
  const consents = session!.perfil.consents;

  useEffect(() => {
    api<{ compartida90d: number }>('/privacy/access-log')
      .then((r) => setShared(r.compartida90d))
      .catch(() => undefined);
  }, []);

  async function toggle(k: keyof Consents, v: boolean) {
    const next = { ...consents, [k]: v };
    setProfile({ ...session!.perfil, consents: next });
    try {
      const r = await api<{ perfil: Profile }>('/consents', { method: 'PUT', body: next });
      setProfile(r.perfil);
    } catch (e) {
      // Sin señal: el cambio se aplica ya en este dispositivo y se sincroniza después.
      if (isOffline(e)) await engine?.saveConsents(next);
    }
  }

  const act = async (fn: () => Promise<void>, ok: string) => {
    setConfirm(null);
    try {
      await fn();
      setNotice(ok);
    } catch (e) {
      setNotice(
        isOffline(e) ? 'Necesitás conexión para hacer esto. Probá cuando vuelva la señal.' : e instanceof ApiError && e.mensaje ? e.mensaje : 'No pudimos completar la acción. Probá de nuevo.',
      );
    }
  };

  const people: Array<[string, string, boolean]> = [
    ['Vos', 'Todo: tus resultados, tu historial y tus conversaciones.', true],
    ['Guardia de emergencia', 'Solo cuando pedís ayuda o hay un riesgo alto.', false],
    ['Tu empresa', 'Solo estadísticas anónimas del grupo. Nunca tu nombre.', false],
  ];

  return (
    <div className="screen" style={{ gap: 28 }}>
      <h1 className="h1" style={{ fontSize: 'clamp(28px, 4.4cqi, 44px)' }}>
        Privacidad y datos
      </h1>
      <section className="stack">
        <h2 className="label">QUIÉN VE QUÉ</h2>
        <div className="grid" style={{ ['--min' as string]: '240px', gap: 12 }}>
          {people.map(([t, d, me]) => (
            <div key={t} className="card" style={{ padding: 20, gap: 8, borderColor: me ? '#2FA8C0' : undefined, borderWidth: me ? 1.5 : 1 }}>
              <div className="display" style={{ fontSize: 20 }}>
                {t}
              </div>
              <div className="muted" style={{ fontSize: 15 }}>
                {d}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="row" style={{ fontSize: 16, color: 'var(--ok-fg)', background: 'rgba(47,168,192,.12)', padding: '14px 18px', borderRadius: 12, flexWrap: 'nowrap' }}>
        <Icon name="privacidad" size={18} />
        {shared === null ? 'Consultando el registro de accesos…' : `Tu información se compartió ${shared} ${shared === 1 ? 'vez' : 'veces'} en los últimos 90 días.`}
      </div>
      <section className="stack">
        <h2 className="label">PERMISOS</h2>
        <div className="list">
          {CONSENT_ITEMS.map(([k, label, desc]) => (
            <div key={k} className="list-row" style={{ padding: '16px 20px', gap: 16 }}>
              <div className="stack" style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 15.5 }}>{label}</div>
                <div className="muted" style={{ fontSize: 14 }}>
                  {desc}
                </div>
              </div>
              <span className="label" style={{ fontSize: 10.5, color: consents[k] ? 'var(--ok-fg)' : 'var(--c-meta)' }}>
                {consents[k] ? 'ACTIVADO' : 'DESACTIVADO'}
              </span>
              <Toggle checked={consents[k]} label={label} onChange={(v) => void toggle(k, v)} />
            </div>
          ))}
        </div>
      </section>
      <section className="stack">
        <h2 className="label">TUS DATOS</h2>
        <div className="row">
          <button type="button" className="btn" onClick={() => void act(downloadMyData, 'Tu archivo está listo. Lo encontrás en Descargas.')}>
            Descargar mis datos
          </button>
          <button type="button" className="btn" onClick={() => (setConfirm('borrar'), setNotice(null))}>
            Borrar mi historial
          </button>
          <button type="button" className="btn btn-danger" onClick={() => (setConfirm('retirar'), setNotice(null))}>
            Retirar mi consentimiento
          </button>
        </div>
        {confirm && (
          <div className="card elevated" style={{ padding: '18px 20px', gap: 12 }} role="alertdialog" aria-live="assertive">
            <div style={{ fontSize: 16 }}>
              {confirm === 'borrar'
                ? '¿Borrar todo tu historial? Se elimina de todos tus dispositivos y no se puede recuperar.'
                : 'Si retirás tu consentimiento, dejamos de procesar tus datos. El botón de emergencia sigue funcionando.'}
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-danger-solid"
                style={{ minHeight: 48, fontSize: 15 }}
                onClick={() =>
                  confirm === 'borrar'
                    ? void act(async () => {
                        await api('/privacy/history', { method: 'DELETE' });
                        await engine?.wipeCheckins();
                        await engine?.sync();
                      }, 'Borramos tu historial de este y de todos tus dispositivos.')
                    : void act(async () => {
                        const r = await api<{ perfil: Profile }>('/privacy/withdraw', { body: {} });
                        setProfile(r.perfil);
                      }, 'Retiraste tu consentimiento. Podés volver a darlo cuando quieras.')
                }
              >
                {confirm === 'borrar' ? 'Sí, borrar' : 'Sí, retirar'}
              </button>
              <button type="button" className="btn" style={{ minHeight: 48, fontSize: 15 }} onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
      </section>
      <p className="meta" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 760 }}>
        Tus datos se tratan según la Ley N.º 25.326 de Protección de Datos Personales (Argentina). Podés ejercer tus derechos de acceso, rectificación y supresión en cualquier momento desde esta pantalla.{' '}
        <Link to="/privacidad/politica">Leer la política completa</Link>
      </p>
    </div>
  );
}

/** Política completa: estructura lista; el texto legal definitivo lo provee el área legal (pendiente). */
export function PolicyPage() {
  return (
    <div className="screen">
      <h1 className="h1">Política de privacidad</h1>
      <article className="prose">
        <p className="warn-text">Texto legal en revisión. La versión definitiva (Argentina, Ley 25.326, y Chile) la publica el área legal antes del lanzamiento.</p>
        <h2>Qué datos usamos</h2>
        <ul>
          <li>Tus respuestas del check-in (ánimo, sueño), los valores del escaneo (pulso, variabilidad, respiración, índice de estrés), la prueba de reacción y la duración de la lectura en voz alta.</li>
          <li>Tus conversaciones con el acompañante, cifradas.</li>
          <li>Tu ubicación, solo si la compartís al pedir ayuda.</li>
        </ul>
        <h2>Qué NO guardamos</h2>
        <ul>
          <li>Video, imágenes de tu cara, audio ni plantillas biométricas.</li>
        </ul>
        <h2>Quién accede</h2>
        <ul>
          <li>Vos, siempre.</li>
          <li>La guardia de tu faena, solo cuando pedís ayuda o hay un riesgo alto. Cada acceso queda registrado y lo ves en Privacidad.</li>
          <li>Tu empresa recibe solo estadísticas anónimas de grupos de al menos 5 personas; si en un grupo hay menos de 3 personas en un mismo nivel, ese dato no se muestra. Nunca tu nombre ni tus resultados.</li>
        </ul>
        <h2>Tus derechos</h2>
        <p>Podés descargar, borrar tus datos o retirar tu consentimiento en cualquier momento desde Privacidad y datos.</p>
      </article>
    </div>
  );
}
