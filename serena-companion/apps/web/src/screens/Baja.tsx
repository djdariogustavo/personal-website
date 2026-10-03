import { useState } from 'react';
import { api, ApiError, isOffline } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { downloadMyData } from './Wellbeing.tsx';

/**
 * Cuenta dada de baja por la empresa. Durante el período de gracia la persona
 * solo puede descargar o eliminar sus datos (Ley 25.326: acceso y supresión).
 * Al vencer, la cuenta se elimina sola.
 */
export function BajaScreen() {
  const { session, config, endSession } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const perfil = session!.perfil;
  const baja = perfil.baja!;
  const lineas = config.lineasAyuda[perfil.org.pais];
  const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

  const fail = (e: unknown) =>
    setNotice(isOffline(e) ? 'Necesitás conexión para hacer esto.' : e instanceof ApiError && e.mensaje ? e.mensaje : 'No pudimos completar la acción. Probá de nuevo.');

  async function eliminar() {
    setBusy(true);
    try {
      await api('/privacy/account', { method: 'DELETE' });
      await endSession({ reason: 'cuenta_eliminada', remote: false, wipe: true });
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ maxWidth: 640, gap: 22 }}>
      <div className="label cyan">TU CUENTA</div>
      <h1 className="h1">Tu cuenta fue dada de baja</h1>
      <p style={{ fontSize: 17, lineHeight: 1.55 }}>
        {perfil.org.nombre} te dio de baja el {fecha(baja.desde)}. Ya no hacés check-ins ni avisos a la guardia desde SERENA. Tus datos siguen siendo tuyos: la empresa nunca
        los vio y no los recibe ahora.
      </p>
      <div className="card" style={{ gap: 10 }}>
        <div className="label">QUÉ PASA CON TUS DATOS</div>
        <p style={{ margin: 0 }}>
          Se eliminan definitivamente el <strong>{fecha(baja.purgaEn)}</strong>. Hasta entonces podés descargarlos o eliminarlos ahora.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => void downloadMyData().then(() => setNotice('Tu archivo está listo. Lo encontrás en Descargas.'), fail)}>
            Descargar mis datos
          </button>
          <button type="button" className="btn btn-danger" onClick={() => (setConfirm(true), setNotice(null))}>
            Eliminar mi cuenta ahora
          </button>
        </div>
        {confirm && (
          <div className="card elevated" style={{ padding: '18px 20px', gap: 12 }} role="alertdialog" aria-live="assertive">
            <div style={{ fontSize: 16 }}>¿Eliminar tu cuenta y todos tus datos? Si no los descargaste, no se pueden recuperar.</div>
            <div className="row">
              <button type="button" className="btn btn-danger-solid" style={{ minHeight: 48, fontSize: 15 }} disabled={busy} onClick={() => void eliminar()}>
                {busy ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
              <button type="button" className="btn" style={{ minHeight: 48, fontSize: 15 }} onClick={() => setConfirm(false)}>
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
      </div>
      <p className="muted" style={{ fontSize: 15, lineHeight: 1.6 }}>
        Si necesitás hablar con alguien:{' '}
        {lineas.map((l, i) => (
          <span key={l.numero}>
            {i > 0 && ' · '}
            {l.nombre}{' '}
            <a href={`tel:${l.numero}`}>
              <strong className="num">{l.numero}</strong>
            </a>
          </span>
        ))}
        . Si creés que la baja es un error, hablá con Recursos Humanos de tu empresa.
      </p>
      <div>
        <button type="button" className="btn" onClick={() => void endSession({ wipe: true })}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
