import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { ChatMessage } from '@serena/domain';
import { api, ApiError, isOffline } from '../lib/api.ts';
import { useApp, useOnline } from '../lib/store.tsx';
import { useEmergency } from '../components/AppShell.tsx';
import { Icon, hhmm } from '../components/ui.tsx';

const QUICK = ['Estoy cansado', 'Extraño a mi familia', 'No puedo dormir', 'Solo quiero charlar'];

type Msg = ChatMessage & { pendiente?: boolean };

/** 6.10 Acompañante SERENA. */
export function Companion() {
  const { session, engine, config } = useApp();
  const online = useOnline();
  const openEmergency = useEmergency();
  const nav = useNavigate();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [care, setCare] = useState(false);
  const [banner, setBanner] = useState(true);
  const [lines, setLines] = useState(false);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const chatAllowed = session?.perfil.consents.chat !== false;
  const lineas = config.lineasAyuda[session?.perfil.org.pais ?? 'AR'];

  useEffect(() => {
    if (!chatAllowed) return;
    api<{ mensajes: ChatMessage[]; cuidado: boolean }>('/companion/messages')
      .then((r) => {
        setMsgs(r.mensajes);
        setCare(r.cuidado);
      })
      .catch(() => undefined);
    // Mensajes que quedaron sin enviar por falta de señal.
    void engine?.db.all<Msg>('chatQueue').then((q) => q.length && setMsgs((m) => [...m, ...q]));
  }, [chatAllowed, engine]);

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [msgs, typing]);

  async function send(text: string, retryId?: string) {
    text = text.trim();
    if (!text) return;
    setError(null);
    const id = retryId ?? crypto.randomUUID();
    const local: Msg = { id, role: 'user', text, createdAt: new Date().toISOString(), pendiente: true };
    if (!retryId) setMsgs((m) => [...m, local]);
    setInput('');
    setTyping(true);
    try {
      const r = await api<{ mensajes: ChatMessage[]; cuidado: boolean }>('/companion/messages', { body: { text, id }, timeoutMs: 90_000 });
      await engine?.db.del('chatQueue', id);
      setMsgs((m) => [...m.filter((x) => x.id !== id), ...r.mensajes]);
      if (r.cuidado) setCare(true);
    } catch (e) {
      if (isOffline(e)) {
        await engine?.db.put('chatQueue', id, local);
        setError('Sin conexión. Te respondo apenas vuelva la señal.');
      } else {
        setMsgs((m) => m.filter((x) => x.id !== id));
        setError(e instanceof ApiError && e.mensaje ? e.mensaje : 'No pude responder ahora. Probá de nuevo en un momento.');
      }
    } finally {
      setTyping(false);
    }
  }

  // Al volver la señal se envían los pendientes.
  useEffect(() => {
    if (!online || !engine) return;
    void engine.db.all<Msg>('chatQueue').then(async (q) => {
      for (const m of q.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) await send(m.text, m.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, engine]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  if (!chatAllowed)
    return (
      <div className="screen narrow">
        <h1 className="h1">Acompañante</h1>
        <p className="muted">Apagaste la conversación con el acompañante. Si querés usarla, activala en Privacidad. Si necesitás hablar con una persona, usá el botón Ayuda.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => nav('/privacidad')}>
            Ir a Privacidad
          </button>
        </div>
      </div>
    );

  return (
    <div className="chat">
      <h1 className="sr-only">Acompañante</h1>
      <div className="row" style={{ flex: 'none', gap: 14, padding: '16px 20px', borderBottom: '1px solid var(--c-line)', flexWrap: 'nowrap' }}>
        <div className="companion-avatar" aria-hidden="true" />
        <div className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <div style={{ fontWeight: 600, fontSize: 17 }}>Acompañante SERENA</div>
          <div style={{ fontSize: 13, color: 'var(--ok-fg)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: online ? 'var(--c-cyan)' : '#6E6E8C' }} />
            {online ? 'Disponible 24/7' : 'Sin conexión'}
          </div>
        </div>
        <button type="button" className="btn" style={{ minHeight: 44, padding: '0 14px', fontSize: 14, flex: 'none' }} onClick={() => openEmergency({ tipo: 'hablar', origen: 'acompanante' })}>
          Hablar con una persona
        </button>
      </div>

      {/* Banner fijo: plegable, nunca eliminable. */}
      <div style={{ flex: 'none', background: 'var(--c-surface-2)', borderBottom: '1px solid var(--c-line)' }}>
        <button
          type="button"
          aria-expanded={banner}
          onClick={() => setBanner(!banner)}
          style={{ width: '100%', minHeight: 44, padding: '10px 20px', border: 'none', background: 'transparent', color: 'var(--c-text)', display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left' }}
        >
          <Icon name="info" size={18} stroke="var(--c-cyan)" />
          <span style={{ fontSize: 14, lineHeight: 1.5, color: banner ? 'var(--c-text)' : 'var(--c-text-2)' }}>
            {banner
              ? 'Soy un acompañante, no un profesional de la salud. Estoy para escucharte y charlar. Si necesitás ayuda profesional, te ayudo a encontrarla.'
              : 'Soy un acompañante, no un profesional de la salud.'}
          </span>
        </button>
      </div>

      {care && (
        <div className="card" style={{ flex: 'none', margin: '16px 20px 0', border: '1.5px solid #F37CC2', padding: 20 }} role="alert">
          <div className="display" style={{ fontSize: 20, lineHeight: 1.3 }}>
            Lo que me contás es importante y merece ayuda de una persona ahora.
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" style={{ flex: '1 1 220px', fontSize: 16 }} onClick={() => openEmergency({ tipo: 'riesgo', origen: 'acompanante' })}>
              Conectarme con la guardia de mi faena
            </button>
            <button type="button" className="btn" style={{ flex: '1 1 200px' }} aria-expanded={lines} onClick={() => setLines(!lines)}>
              Llamar a una línea de ayuda
            </button>
          </div>
          {lines && (
            <div className="stack" style={{ gap: 8, padding: 14, background: 'var(--c-surface-2)', borderRadius: 8, fontSize: 15 }}>
              {lineas.map((l) => (
                <div key={l.numero}>
                  {l.nombre} ·{' '}
                  <a href={`tel:${l.numero}`}>
                    <strong className="num">{l.numero}</strong>
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="stack" style={{ flex: 1, padding: 20, gap: 14 }} aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.role === 'user' ? 'user' : 'bot'}`}>
            <div>{m.text}</div>
            <time dateTime={m.createdAt}>{m.pendiente ? 'Sin enviar · se envía con señal' : hhmm(m.createdAt)}</time>
          </div>
        ))}
        {typing && (
          <div className="bubble bot" aria-label="El acompañante está escribiendo">
            <div className="muted">…</div>
          </div>
        )}
        {error && <div className="warn-text">{error}</div>}
        <div ref={end} />
      </div>

      <form className="stack" onSubmit={submit} style={{ position: 'sticky', bottom: 0, flex: 'none', background: 'var(--c-bg)', borderTop: '1px solid var(--c-line)', padding: '12px 20px 16px', gap: 10 }}>
        <div className="quick-replies">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => void send(q)}>
              {q}
            </button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
          <label className="sr-only" htmlFor="chat-input">
            Mensaje
          </label>
          <input id="chat-input" className="input" value={input} maxLength={2000} onChange={(e) => setInput(e.target.value)} placeholder="Escribí lo que quieras" style={{ flex: 1, minWidth: 0 }} />
          <button type="submit" aria-label="Enviar" style={{ width: 52, height: 52, flex: 'none', border: 'none', borderRadius: 2, background: 'var(--c-cyan)', color: 'var(--c-on-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="send" size={20} width={1.8} />
          </button>
        </div>
      </form>
    </div>
  );
}
