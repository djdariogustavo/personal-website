import { useEffect, useState } from 'react';
import { isEntitled, type SubscriptionSummary } from '@serena/domain';
import { api } from '../../lib/api.ts';
import { errMsg } from './comun.tsx';

interface Trabajador {
  id: string;
  nombre: string;
  legajo: string | null;
  puesto: string;
  estado: 'activo' | 'baja';
  baja: { desde: string; purgaEn: string } | null;
}

const dia = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Personas del equipo: alta, baja y reactivación. Solo datos de la relación
 * laboral; nunca niveles, check-ins ni uso de la app.
 */
function TeamList({ version, onCreds }: { version: number; onCreds: (c: Record<string, string>) => void }) {
  const [data, setData] = useState<{ trabajadores: Trabajador[]; suscripcion: SubscriptionSummary } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; tipo: 'baja' | 'password' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () =>
    api<{ trabajadores: Trabajador[]; suscripcion: SubscriptionSummary }>('/admin/workers')
      .then(setData)
      .catch((e) => setError(errMsg(e)));
  useEffect(() => void load(), [version]);

  async function baja(t: Trabajador) {
    setConfirm(null);
    setError(null);
    try {
      const r = await api<{ purgaEn: string }>(`/admin/workers/${t.id}/baja`, { body: {} });
      setNotice(`Se dio de baja a ${t.nombre}. Se liberó su puesto. Sus datos se eliminan el ${dia(r.purgaEn)}.`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function restablecer(t: Trabajador) {
    setConfirm(null);
    setError(null);
    try {
      const r = await api<{ passwordTemporal: string }>(`/admin/workers/${t.id}/password`, { body: {} });
      setNotice(`Se restableció la contraseña de ${t.nombre}. Entregale en mano la temporal: al ingresar va a tener que elegir una propia.`);
      onCreds({ persona: t.nombre, passwordTemporal: r.passwordTemporal });
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function reactivar(t: Trabajador) {
    setError(null);
    try {
      const r = await api<{ credenciales: Record<string, string> }>(`/admin/workers/${t.id}/reactivar`, { body: {} });
      setNotice(`Se reactivó a ${t.nombre}. Entregá en mano el PIN y el QR nuevos; su contraseña no cambia.`);
      onCreds(r.credenciales);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const sub = data?.suscripcion;
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="label">PERSONAS</div>
        {sub && isEntitled(sub.estado) && (
          <span className="chip chip-neutral">
            {sub.puestosEnUso} DE {sub.puestos} PUESTOS EN USO
          </span>
        )}
      </div>
      {error && <div className="alert">{error}</div>}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      {data && data.trabajadores.length === 0 && <p className="muted">Todavía no hay personas dadas de alta.</p>}
      <div className="list">
        {data?.trabajadores.map((t) => (
          <div key={t.id} className="stack" style={{ gap: 10 }}>
            <div className="list-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 220px' }}>
                <div style={{ fontWeight: 600 }}>{t.nombre}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Legajo {t.legajo ?? '—'}
                  {t.puesto ? ` · ${t.puesto}` : ''}
                  {t.baja ? ` · baja el ${dia(t.baja.desde)} · datos hasta el ${dia(t.baja.purgaEn)}` : ''}
                </div>
              </div>
              {t.estado === 'activo' ? (
                <>
                  <button type="button" className="btn" style={{ minHeight: 44, fontSize: 14 }} onClick={() => (setConfirm({ id: t.id, tipo: 'password' }), setNotice(null))}>
                    Restablecer contraseña
                  </button>
                  <button type="button" className="btn btn-danger" style={{ minHeight: 44, fontSize: 14 }} onClick={() => (setConfirm({ id: t.id, tipo: 'baja' }), setNotice(null))}>
                    Dar de baja
                  </button>
                </>
              ) : (
                <>
                  <span className="chip chip-neutral">DE BAJA</span>
                  <button type="button" className="btn" style={{ minHeight: 44, fontSize: 14 }} onClick={() => void reactivar(t)}>
                    Reactivar
                  </button>
                </>
              )}
            </div>
            {confirm?.id === t.id && confirm.tipo === 'password' && (
              <div className="card elevated" style={{ padding: '18px 20px', gap: 12 }} role="alertdialog" aria-live="assertive" aria-label={`Restablecer la contraseña de ${t.nombre}`}>
                <div style={{ fontSize: 15, lineHeight: 1.55 }}>
                  ¿Restablecer la contraseña de <strong>{t.nombre}</strong>? Usalo solo si no puede recuperarla por SMS (por ejemplo, perdió el teléfono). Se cierran sus sesiones, se le avisa por
                  SMS y se genera una contraseña temporal para entregarle en mano; al ingresar tendrá que elegir una propia, que la empresa no conoce.
                </div>
                <div className="row">
                  <button type="button" className="btn btn-primary" style={{ minHeight: 48, fontSize: 15 }} onClick={() => void restablecer(t)}>
                    Sí, restablecer
                  </button>
                  <button type="button" className="btn" style={{ minHeight: 48, fontSize: 15 }} onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {confirm?.id === t.id && confirm.tipo === 'baja' && (
              <div className="card elevated" style={{ padding: '18px 20px', gap: 12 }} role="alertdialog" aria-live="assertive" aria-label={`Dar de baja a ${t.nombre}`}>
                <div style={{ fontSize: 15, lineHeight: 1.55 }}>
                  ¿Dar de baja a <strong>{t.nombre}</strong>? Se libera su puesto y se cierran sus sesiones en todos los dispositivos; su PIN y QR dejan de funcionar. Durante 30 días
                  podrá ingresar solo para descargar o eliminar sus datos; después se eliminan. La empresa no accede a esos datos en ningún momento.
                </div>
                <div className="row">
                  <button type="button" className="btn btn-danger-solid" style={{ minHeight: 48, fontSize: 15 }} onClick={() => void baja(t)}>
                    Sí, dar de baja
                  </button>
                  <button type="button" className="btn" style={{ minHeight: 48, fontSize: 15 }} onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function AdminTeam() {
  const [kiosks, setKiosks] = useState<Array<{ id: string; nombre: string; creado_en: string; revocado_en: string | null }>>([]);
  const [newKiosk, setNewKiosk] = useState('');
  const [kioskToken, setKioskToken] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [w, setW] = useState({ nombre: '', nombreCorto: '', puesto: '', dni: '', legajo: '', telefono: '', rosterInicio: new Date().toISOString().slice(0, 10), turno: 'dia' });

  const load = () =>
    api<{ kioscos: typeof kiosks }>('/admin/kiosks')
      .then((r) => setKiosks(r.kioscos))
      .catch((e) => setError(errMsg(e)));
  useEffect(() => void load(), []);

  return (
    <div className="screen">
      <h1 className="h1">Equipo y kioscos</h1>
      {error && <div className="alert">{error}</div>}
      <TeamList version={version} onCreds={setCreds} />
      {creds && (
        <div className="card elevated">
          <div className="label">CREDENCIALES · SE MUESTRAN UNA SOLA VEZ</div>
          <p className="muted" style={{ fontSize: 14 }}>
            Entregalas en mano.
          </p>
          <table className="table">
            <tbody>
              {Object.entries(creds).map(([k, v]) => (
                <tr key={k}>
                  <td className="label">{k}</td>
                  <td className="num" style={{ wordBreak: 'break-all' }}>
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="card">
        <div className="label">KIOSCOS REGISTRADOS</div>
        <div className="list">
          {kiosks.map((k) => (
            <div key={k.id} className="list-row">
              <div style={{ flex: 1 }}>{k.nombre}</div>
              {k.revocado_en ? (
                <span className="chip chip-neutral">REVOCADO</span>
              ) : (
                <button type="button" className="btn btn-danger" style={{ minHeight: 44, fontSize: 14 }} onClick={() => void api(`/admin/kiosks/${k.id}`, { method: 'DELETE' }).then(load)}>
                  Revocar
                </button>
              )}
            </div>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void api<{ token: string }>('/admin/kiosks', { body: { nombre: newKiosk } })
              .then((r) => (setKioskToken(r.token), setNewKiosk(''), load()))
              .catch((er) => setError(errMsg(er)));
          }}
        >
          <input className="input" style={{ flex: '1 1 240px' }} placeholder="Nombre del kiosco (p. ej. Comedor — Módulo 3)" value={newKiosk} onChange={(e) => setNewKiosk(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={newKiosk.length < 2}>
            Registrar kiosco
          </button>
        </form>
        {kioskToken && (
          <div className="card elevated">
            <div className="label">CÓDIGO DEL KIOSCO · SE MUESTRA UNA SOLA VEZ</div>
            <code className="num" style={{ wordBreak: 'break-all' }}>
              {kioskToken}
            </code>
            <p className="muted" style={{ fontSize: 14 }}>
              Abrí /kiosco en la tablet y pegá este código.
            </p>
          </div>
        )}
      </section>
      <section className="card">
        <div className="label">ALTA DE UNA PERSONA</div>
        <form
          className="grid"
          style={{ ['--min' as string]: '220px', gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void api<{ credenciales: Record<string, string> }>('/admin/workers', { body: { ...w, telefono: w.telefono || undefined } })
              .then((r) => (setCreds(r.credenciales), setVersion((v) => v + 1)))
              .catch((er) => setError(errMsg(er)));
          }}
        >
          {(
            [
              ['nombre', 'NOMBRE Y APELLIDO'],
              ['nombreCorto', 'CÓMO LE DECIMOS'],
              ['puesto', 'PUESTO'],
              ['dni', 'DNI'],
              ['legajo', 'LEGAJO'],
              ['telefono', 'TELÉFONO (2FA)'],
              ['rosterInicio', 'DÍA 1 DEL ROSTER'],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span className="label">{l}</span>
              <input className="input" type={k === 'rosterInicio' ? 'date' : 'text'} value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} required={k !== 'telefono' && k !== 'puesto'} />
            </label>
          ))}
          <label className="field">
            <span className="label">TURNO</span>
            <select className="input" value={w.turno} onChange={(e) => setW({ ...w, turno: e.target.value })}>
              <option value="dia">Día</option>
              <option value="noche">Noche</option>
            </select>
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button type="submit" className="btn btn-primary btn-block">
              Dar de alta
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
