import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { type CeldaPublicable } from '@serena/domain';
import { api, ApiError } from '../../lib/api.ts';
import { errMsg, Stat } from './comun.tsx';

interface Stats {
  periodo: { desde: string; hasta: string };
  ventanaDias: number;
  kAnonimato: number;
  kCelda: number;
  participacion: { personas: number | null; checkins: number | null; activos: number };
  porDiaDeRoster: Array<{ dia: number } & CeldaPublicable>;
  escalamientos28d: number | string;
}

const ATENCION = 'repeating-linear-gradient(135deg, var(--warn-fg) 0 5px, var(--alert-fg) 5px 10px)';

/** Fecha corta del período (la ventana termina el lunes a las 00:00 UTC, se muestra el domingo). */
const fecha = (iso: string, finExclusivo = false) =>
  new Date(Date.parse(iso) - (finExclusivo ? 1 : 0)).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function oculto(d: CeldaPublicable, s: Stats): string {
  if (d.motivo === 'grupo_chico') return `Grupo menor a ${s.kAnonimato}: no se muestra`;
  if (d.motivo === 'homogeneo') return 'No se muestra: todo el grupo en el mismo rango identificaría a cada persona';
  return `No se muestra: alguna categoría tiene menos de ${s.kCelda} personas`;
}

export function AdminStats() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<{ code: string; msg: string } | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    api<Stats>('/admin/stats')
      .then(setS)
      .catch((e) => setError({ code: e instanceof ApiError ? e.code : '', msg: errMsg(e) }));
  }, []);

  return (
    <div className="screen">
      <div className="stack">
        <div className="label cyan">ESTADÍSTICAS ANÓNIMAS DEL GRUPO</div>
        <h1 className="h1">Reportes</h1>
        <p className="muted" style={{ maxWidth: 760 }}>
          Solo se muestran grupos de al menos {s?.kAnonimato ?? 5} personas y categorías de al menos {s?.kCelda ?? 3}. Nunca se ven nombres, resultados
          individuales ni conversaciones.
        </p>
        {s && (
          <p className="meta">
            Período: {fecha(s.periodo.desde)} al {fecha(s.periodo.hasta, true)} · se actualiza cada lunes · porcentajes redondeados a 5 puntos
          </p>
        )}
      </div>
      {error && (
        <div className="card">
          <p>{error.msg}</p>
          {error.code === 'suscripcion_inactiva' && (
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={() => nav('/admin/facturacion')}>
                Ir a Facturación
              </button>
            </div>
          )}
        </div>
      )}
      {s && (
        <>
          <div className="grid" style={{ ['--min' as string]: '220px' }}>
            <Stat label="PERSONAS ACTIVAS" value={String(s.participacion.activos)} />
            <Stat label={`PARTICIPARON · ${s.ventanaDias} DÍAS`} value={s.participacion.personas === null ? `< ${s.kAnonimato}` : String(s.participacion.personas)} />
            <Stat label="CHECK-INS" value={s.participacion.checkins === null ? '—' : String(s.participacion.checkins)} />
            <Stat label="PEDIDOS DE AYUDA" value={String(s.escalamientos28d)} />
          </div>
          <figure className="card" style={{ margin: 0 }}>
            <figcaption className="label">DISTRIBUCIÓN DE NIVELES POR DÍA DE ROSTER · EN TURNO</figcaption>
            <div className="row muted" style={{ gap: 14, fontSize: 12 }}>
              {(
                [
                  ['Bien', 'var(--ok-fg)'],
                  ['Moderado', 'var(--warn-fg)'],
                  ['Alto', 'var(--alert-fg)'],
                  ['Moderado o alto (agrupados por ser pocos)', ATENCION],
                ] as const
              ).map(([l, c]) => (
                <span key={l} className="row" style={{ gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, background: c }} />
                  {l}
                </span>
              ))}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>DÍA</th>
                  <th style={{ width: '60%' }}>DISTRIBUCIÓN</th>
                  <th>PERSONAS</th>
                </tr>
              </thead>
              <tbody>
                {s.porDiaDeRoster.map((d) => (
                  <tr key={d.dia}>
                    <td className="num">{d.dia}</td>
                    <td>
                      {d.distribucion?.tipo === 'completa' ? (
                        <div
                          style={{ display: 'flex', gap: 2, height: 14 }}
                          role="img"
                          aria-label={`Bien ${pct(d.distribucion.bajo)}, moderado ${pct(d.distribucion.moderado)}, alto ${pct(d.distribucion.alto)}`}
                          title={`Bien ${pct(d.distribucion.bajo)} · Moderado ${pct(d.distribucion.moderado)} · Alto ${pct(d.distribucion.alto)}`}
                        >
                          <span style={{ width: pct(d.distribucion.bajo), background: 'var(--ok-fg)', borderRadius: 2 }} />
                          <span style={{ width: pct(d.distribucion.moderado), background: 'var(--warn-fg)', borderRadius: 2 }} />
                          <span style={{ width: pct(d.distribucion.alto), background: 'var(--alert-fg)', borderRadius: 2 }} />
                        </div>
                      ) : d.distribucion?.tipo === 'agrupada' ? (
                        <div
                          style={{ display: 'flex', gap: 2, height: 14 }}
                          role="img"
                          aria-label={`Bien ${pct(d.distribucion.bajo)}, moderado o alto ${pct(d.distribucion.atencion)}`}
                          title={`Bien ${pct(d.distribucion.bajo)} · Moderado o alto ${pct(d.distribucion.atencion)}`}
                        >
                          <span style={{ width: pct(d.distribucion.bajo), background: 'var(--ok-fg)', borderRadius: 2 }} />
                          <span style={{ width: pct(d.distribucion.atencion), background: ATENCION, borderRadius: 2 }} />
                        </div>
                      ) : (
                        <span className="meta">{oculto(d, s)}</span>
                      )}
                    </td>
                    <td className="num">{d.personas ?? `< ${s.kAnonimato}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        </>
      )}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
