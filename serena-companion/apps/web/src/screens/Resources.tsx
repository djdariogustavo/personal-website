import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { RESOURCES } from './resources-content.ts';
import { useEmergency } from '../components/AppShell.tsx';

/** 6.12 Recursos. */
export function Resources() {
  const nav = useNavigate();
  return (
    <div className="screen">
      <h1 className="h1" style={{ fontSize: 'clamp(28px, 4.4cqi, 44px)' }}>
        Recursos
      </h1>
      <div className="grid" style={{ ['--min' as string]: '300px', gap: 14 }}>
        <div className="card accent" style={{ padding: 22 }}>
          <span className="label cyan">RESPIRACIÓN GUIADA</span>
          <div className="display" style={{ fontSize: 22, lineHeight: 1.2 }}>
            Un minuto para bajar un cambio
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-data num" style={{ minHeight: 48, fontSize: 13 }} onClick={() => nav('/respirar?min=2')}>
              2 MIN
            </button>
            <button type="button" className="btn num" style={{ minHeight: 48, fontSize: 13 }} onClick={() => nav('/respirar?min=5')}>
              5 MIN
            </button>
          </div>
        </div>
        {RESOURCES.map((r) => (
          <Link key={r.slug} to={`/recursos/${r.slug}`} className="card" style={{ padding: 22, gap: 10, textDecoration: 'none', color: 'var(--c-text)' }}>
            <span className="label">{r.etiqueta}</span>
            <div className="display" style={{ fontSize: 20, lineHeight: 1.25 }}>
              {r.titulo}
            </div>
            <div className="muted" style={{ fontSize: 15 }}>
              {r.bajada}
            </div>
            {r.slug === 'alcohol-y-descanso' && <span style={{ color: 'var(--data)', fontSize: 15 }}>Acceso confidencial a ayuda</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ResourceDetail() {
  const { slug } = useParams();
  const { hash } = useLocation();
  const openEmergency = useEmergency();
  const r = RESOURCES.find((x) => x.slug === slug);
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  if (!r)
    return (
      <div className="screen">
        <p className="muted">No encontramos este recurso.</p>
        <Link to="/recursos">Volver a Recursos</Link>
      </div>
    );
  return (
    <div className="screen">
      <Link to="/recursos" className="btn-text" style={{ alignSelf: 'flex-start' }}>
        ← Recursos
      </Link>
      <div className="stack">
        <span className="label cyan">{r.etiqueta}</span>
        <h1 className="h1">{r.titulo}</h1>
        <p className="muted" style={{ fontSize: 18 }}>
          {r.bajada}
        </p>
      </div>
      <article className="prose">
        {r.secciones.map((s) => (
          <section key={s.titulo} id={s.id} className="stack" style={{ gap: 10 }}>
            <h2>{s.titulo}</h2>
            {s.parrafos?.map((p) => <p key={p}>{p}</p>)}
            {s.items && (
              <ul>
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>
      {r.slug === 'alcohol-y-descanso' && (
        <div className="actions">
          <button type="button" className="btn" onClick={() => openEmergency({ tipo: 'hablar' })}>
            Pedir hablar con alguien, en confianza
          </button>
        </div>
      )}
    </div>
  );
}
