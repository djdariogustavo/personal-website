import { useEffect, useState } from 'react';
import type { DeviceInfo } from '@serena/domain';
import { api } from '../lib/api.ts';
import { useSync } from '../lib/store.tsx';
import { Icon } from '../components/ui.tsx';

function ago(iso: string | null) {
  if (!iso) return 'sin sincronizar';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}

/** 6.15 Dispositivos y sincronización. */
export function Devices() {
  const sync = useSync();
  const [list, setList] = useState<DeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ dispositivos: DeviceInfo[] }>('/devices')
      .then((r) => setList(r.dispositivos))
      .catch(() => setError('Sin conexión: la lista de dispositivos se actualiza cuando vuelve la señal.'));
  useEffect(() => void load(), []);

  const pend = sync.estado === 'pendiente' || sync.estado === 'offline';
  const chip =
    sync.estado === 'sincronizando'
      ? 'SINCRONIZANDO…'
      : pend && sync.pendientes
        ? `${sync.pendientes} REGISTRO${sync.pendientes === 1 ? '' : 'S'} ESPERANDO CONEXIÓN`
        : sync.estado === 'offline'
          ? 'SIN CONEXIÓN'
          : `SINCRONIZADO · ${ago(sync.ultimaSync).toUpperCase()}`;

  return (
    <div className="screen">
      <div className="stack">
        <h1 className="h1" style={{ fontSize: 'clamp(28px, 4.4cqi, 44px)' }}>
          Dispositivos
        </h1>
        <span className={`chip ${pend ? 'chip-warn' : 'chip-ok'}`} role="status">
          {chip}
        </span>
      </div>
      <p className="muted" style={{ maxWidth: 720, lineHeight: 1.6 }}>
        Todo lo que hagas en el campamento aparece en tu teléfono y en la web de tu casa. Sin señal, la app guarda todo cifrado y lo sube cuando vuelve la conexión.
      </p>
      {error && <div className="warn-text">{error}</div>}
      {list && (
        <div className="list">
          {list.map((d) => (
            <div key={d.id} className="list-row" style={{ padding: '18px 20px', gap: 16, flexWrap: 'wrap' }}>
              <Icon name={d.kind === 'mobile' ? 'mobile' : d.kind === 'desktop' ? 'desktop' : 'tablet'} size={28} stroke="var(--c-cyan)" />
              <div className="stack" style={{ flex: '1 1 200px', minWidth: 0, gap: 4 }}>
                <div style={{ fontWeight: 600 }}>
                  {d.nombre}
                  {d.actual && <span className="meta" style={{ fontWeight: 400, fontSize: 14 }}> · este dispositivo</span>}
                </div>
                <div className="muted" style={{ fontSize: 14 }}>
                  {d.sistema} · {d.cerrado ? 'Sesión cerrada' : `Última sincronización: ${ago(d.ultimaSync)}`}
                </div>
                {d.efimero && <span className="chip chip-outline">SESIÓN EFÍMERA · NO GUARDA DATOS</span>}
              </div>
              {!d.cerrado && !d.actual && !d.efimero && (
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 48, fontSize: 14 }}
                  onClick={() =>
                    void api(`/devices/${d.id}`, { method: 'DELETE' })
                      .then(load)
                      .catch(() => setError('Necesitás conexión para cerrar la sesión en otro dispositivo.'))
                  }
                >
                  Cerrar sesión en este dispositivo
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
