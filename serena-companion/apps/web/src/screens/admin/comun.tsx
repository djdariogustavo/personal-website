import { ApiError, isOffline } from '../../lib/api.ts';

/** Tarjeta con un valor destacado (estadísticas y facturación). */
export function Stat({ label, value }: { label: string; value: string }) {
  const numeric = /^[\d\s/<.,—-]+$/.test(value);
  return (
    <div className="value-card big" style={{ padding: 20 }}>
      <div className="label" style={{ fontSize: 10.5 }}>
        {label}
      </div>
      <div className="v" style={numeric ? undefined : { fontFamily: 'var(--font-ui)', fontSize: 20, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

/** Mensaje para la persona a partir de un error de la API (compartido por las pantallas del panel). */
export function errMsg(e: unknown) {
  if (isOffline(e)) return e.motivo === 'servidor' ? 'El servidor no respondió. Probá de nuevo en unos minutos.' : 'Sin conexión.';
  if (e instanceof ApiError) return e.mensaje || e.code;
  return 'Algo salió mal.';
}
