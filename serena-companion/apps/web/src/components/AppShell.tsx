import { asset } from '../demo/flags.ts';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import type { EmergencyType } from '@serena/domain';
import { useApp, useSync } from '../lib/store.tsx';
import { useLayout } from '../lib/device.ts';
import { EmergencySheet } from './EmergencySheet.tsx';
import { Icon, type IconName } from './ui.tsx';

const NAV: Array<[string, string, IconName]> = [
  ['/', 'Hoy', 'hoy'],
  ['/checkin', 'Check-in', 'checkin'],
  ['/acompanante', 'Acompañante', 'chat'],
  ['/bienestar', 'Mi bienestar', 'bienestar'],
  ['/recursos', 'Recursos', 'recursos'],
];
const NAV_DESK: Array<[string, string, IconName]> = [
  ['/privacidad', 'Privacidad', 'privacidad'],
  ['/dispositivos', 'Dispositivos', 'dispositivos'],
];
const ADMIN_NAV: Array<[string, string, IconName]> = [
  ['/admin', 'Reportes', 'chart'],
  ['/admin/equipo', 'Equipo y kioscos', 'users'],
  ['/admin/facturacion', 'Facturación', 'billing'],
];

const EmergencyCtx = createContext<(o?: { origen?: 'boton' | 'acompanante'; tipo?: EmergencyType }) => void>(() => {});
export const useEmergency = () => useContext(EmergencyCtx);

const TITLES: Record<string, string> = {
  '/': 'Hoy',
  '/checkin': 'Check-in',
  '/resultado': 'Resultado',
  '/respirar': 'Respiración guiada',
  '/acompanante': 'Acompañante',
  '/bienestar': 'Mi bienestar',
  '/recursos': 'Recursos',
  '/privacidad': 'Privacidad y datos',
  '/dispositivos': 'Dispositivos',
  '/contrasena': 'Contraseña',
  '/admin/contrasena': 'Contraseña',
  '/admin': 'Administración',
};

export function SyncIndicator({ showLabel }: { showLabel: boolean }) {
  const s = useSync();
  const label = { ok: 'SINCRONIZADO', sincronizando: 'SINCRONIZANDO', pendiente: 'PENDIENTE', offline: 'SIN CONEXIÓN' }[s.estado];
  return (
    <div title={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }} role="status" aria-label={`Estado: ${label.toLowerCase()}`}>
      {s.estado === 'sincronizando' ? <span className="spinner" data-anim /> : <span className={`sync-dot ${s.estado}`} />}
      {showLabel && (
        <span className="label" style={{ fontSize: 11 }}>
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * Armazón: barra lateral (tablet colapsada / escritorio), encabezado con
 * sincronización + avatar + píldora "Ayuda" (siempre visible), banner sin
 * conexión, barra inferior en móvil, hoja de emergencia y cierre por inactividad.
 */
export function AppShell({ children, hideNav = false, kiosk = false }: { children: ReactNode; hideNav?: boolean; kiosk?: boolean }) {
  const layout = useLayout();
  const { session, config, lock, endSession, flushPending, theme, setTheme } = useApp();
  const [logoutPending, setLogoutPending] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const logout = () => void endSession().then(() => nav('/ingresar'));
  const requestLogout = async () => {
    setLoggingOut(true);
    const n = await flushPending();
    setLoggingOut(false);
    if (n > 0) setLogoutPending(n);
    else logout();
  };
  const sync = useSync();
  const loc = useLocation();
  const nav = useNavigate();
  const [emerg, setEmerg] = useState<{ origen?: 'boton' | 'acompanante'; tipo?: EmergencyType } | null>(null);
  const [menu, setMenu] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  const isAdmin = session?.perfil.role === 'admin';
  const isMobile = layout === 'mobile' && !kiosk;
  // Cuenta dada de baja: solo la pantalla de sus datos, sin navegación, sincronización ni aviso a la guardia.
  const baja = !!session?.perfil.baja;
  // Contraseña temporal: sin navegación ni sincronización hasta elegir una propia (el botón Ayuda sigue).
  const temporal = !!session?.perfil.debeCambiarPassword;
  const showSidebar = !isMobile && !kiosk && !!session && !baja && !temporal;
  const collapsed = layout === 'tablet';

  useEffect(() => scrollRef.current?.scrollTo(0, 0), [loc.pathname]);

  // Cierre por inactividad: 5 min en tablet y kiosco, 15 min en escritorio; en el teléfono se bloquea con el PIN.
  // Un minuto antes se avisa y se puede seguir (WCAG 2.2.1); cualquier actividad cancela el aviso.
  const [avisoCierre, setAvisoCierre] = useState<number | null>(null);
  useEffect(() => {
    if (!session) return;
    const kind = session.deviceKind;
    const ms = config.sesion.inactividadMin[kind] * 60_000;
    const antes = Math.min(60_000, ms / 2);
    let t: ReturnType<typeof setTimeout>;
    let w: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(t);
      clearTimeout(w);
      setAvisoCierre(null);
      if (kind !== 'mobile') w = setTimeout(() => setAvisoCierre(Date.now() + antes), ms - antes);
      t = setTimeout(() => {
        setAvisoCierre(null);
        if (kind === 'mobile') lock();
        else void endSession({ reason: 'sesion_inactividad' }).then(() => kind === 'kiosk' && nav('/kiosco'));
      }, ms);
    };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true, capture: true }));
    reset();
    return () => {
      clearTimeout(t);
      clearTimeout(w);
      evs.forEach((e) => window.removeEventListener(e, reset, { capture: true }));
    };
  }, [session, config, lock, endSession, nav]);

  const title = TITLES[Object.keys(TITLES).filter((k) => loc.pathname === k || (k !== '/' && loc.pathname.startsWith(k))).sort((a, b) => b.length - a.length)[0] ?? ''] ?? '';

  // Cada pantalla tiene su título (WCAG 2.4.2) y, al navegar, el foco pasa al contenido para que el
  // lector de pantalla anuncie la pantalla nueva en vez de quedarse en el enlace que se tocó.
  const primera = useRef(true);
  useEffect(() => {
    const h1 = scrollRef.current?.querySelector('h1')?.textContent?.trim();
    document.title = `${h1 || title || (kiosk ? 'Kiosco' : 'SERENA')} · SERENA Companion`;
    if (primera.current) {
      primera.current = false;
      return;
    }
    scrollRef.current?.focus({ preventScroll: true });
  }, [loc.pathname, title, kiosk]);
  const items = isAdmin ? ADMIN_NAV : [...NAV, ...NAV_DESK];

  return (
    <EmergencyCtx.Provider value={(o) => setEmerg(o ?? {})}>
      <div className={`app ${isMobile ? 'is-mobile' : ''}`} data-kiosk={kiosk ? '' : undefined}>
        <a href="#main" className="skip-link" onClick={(e) => (e.preventDefault(), scrollRef.current?.focus())}>
          Saltar al contenido
        </a>
        {showSidebar && (
          <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Principal">
            {collapsed ? <img src={asset('serena-mark.png')} alt="SERENA" className="mark" /> : <img src={asset('serena-logo-white.png')} alt="SERENA" className="logo" />}
            {items.map(([to, label, icon]) => (
              <NavLink key={to} to={to} end={to === '/' || to === '/admin'} className="nav-item" title={label}>
                <Icon name={icon} />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            ))}
            <div className="spacer" />
            {!collapsed && session && (
              <div className="who">
                <div style={{ fontWeight: 600, fontSize: 15 }}>{session.perfil.nombre}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {session.perfil.puesto} · {session.perfil.org.faena}
                </div>
              </div>
            )}
          </nav>
        )}
        <div className="main">
          <header className="header">
            {!showSidebar && <img src={asset('serena-logo-white.png')} alt="SERENA" className="logo" />}
            {showSidebar && (
              <div className="label" style={{ fontSize: 12 }}>
                {title.toUpperCase()}
              </div>
            )}
            {kiosk && session && (
              <div className="label" style={{ fontSize: 14, marginLeft: 12 }}>
                SESIÓN EFÍMERA · SE CIERRA A LOS {config.sesion.inactividadMin.kiosk} MIN SIN USO
              </div>
            )}
            <div className="spacer" />
            {session && !baja && !temporal && <SyncIndicator showLabel={!isMobile && !kiosk} />}
            {session && !kiosk && (
              <div style={{ position: 'relative' }}>
                <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} aria-label="Menú de la cuenta">
                  {session.perfil.iniciales}
                </button>
                {menu && (
                  <div className="menu" role="menu" onClick={() => setMenu(false)}>
                    <button type="button" role="menuitemcheckbox" aria-checked={theme === 'sol'} onClick={() => setTheme(theme === 'sol' ? 'noche' : 'sol')}>
                      <Icon name="sun" /> Modo alto contraste (sol)
                    </button>
                    {!baja && !temporal && (
                      <NavLink to={isAdmin ? '/admin/contrasena' : '/contrasena'} role="menuitem">
                        <Icon name="lock" /> Cambiar contraseña
                      </NavLink>
                    )}
                    {!isAdmin && !baja && !temporal && (
                      <>
                        <NavLink to="/privacidad" role="menuitem">
                          <Icon name="privacidad" /> Privacidad y datos
                        </NavLink>
                        <NavLink to="/dispositivos" role="menuitem">
                          <Icon name="dispositivos" /> Dispositivos
                        </NavLink>
                      </>
                    )}
                    <button type="button" role="menuitem" disabled={loggingOut} onClick={() => void requestLogout()}>
                      <Icon name="logout" /> {loggingOut ? 'Subiendo tus registros…' : 'Cerrar sesión'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {!isAdmin && !baja && (
              <button type="button" className="help-pill" onClick={() => setEmerg({})}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 13v8M8.8 9.8a4.5 4.5 0 0 1 6.4 0M5.6 6.6a9 9 0 0 1 12.8 0" />
                  <circle cx="12" cy="13" r="1.2" fill="currentColor" />
                </svg>
                Ayuda
              </button>
            )}
          </header>
          {sync.estado === 'offline' && session && !baja && !temporal && (
            <div className="offline-banner" role="status">
              <Icon name="wifiOff" size={18} stroke="#B8B8CB" />
              Sin conexión. Todo se guarda y se sincroniza después.
            </div>
          )}
          {/* tabIndex 0: el contenido se desplaza dentro de este contenedor y tiene que poder hacerse con teclado. */}
          <main className="scroll" ref={scrollRef} id="main" tabIndex={0}>
            {children}
          </main>
          {isMobile && session && !hideNav && !isAdmin && !baja && !temporal && (
            <nav className="bottom-nav" aria-label="Principal">
              {NAV.map(([to, label, icon]) => (
                <NavLink key={to} to={to} end={to === '/'} aria-current={to === '/checkin' && /^\/(checkin|resultado|respirar)/.test(loc.pathname) ? 'page' : undefined}>
                  <Icon name={icon} size={24} />
                  {label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
        {logoutPending !== null && (
          <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" style={{ zIndex: 45 }}>
            <div className="card" style={{ maxWidth: 460, gap: 16 }}>
              <h2 id="logout-title" className="display" style={{ fontSize: 22, lineHeight: 1.2 }}>
                Hay {logoutPending} registro{logoutPending === 1 ? '' : 's'} sin subir
              </h2>
              <p className="muted">
                No hay señal para subirlos ahora. Si cerrás sesión, quedan guardados cifrados en este equipo y se suben solos la próxima vez que ingreses acá.
              </p>
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => (setLogoutPending(null), void requestLogout())}>
                  Reintentar ahora
                </button>
                <button type="button" className="btn" onClick={() => (setLogoutPending(null), logout())}>
                  Cerrar sesión igual
                </button>
                <button type="button" className="btn-link" onClick={() => setLogoutPending(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
        {avisoCierre !== null && <AvisoCierre hasta={avisoCierre} onSeguir={() => setAvisoCierre(null)} />}
        {emerg && <EmergencySheet onClose={() => setEmerg(null)} origen={emerg.origen} preset={emerg.tipo} />}
      </div>
    </EmergencyCtx.Provider>
  );
}

/** "¿Seguís ahí?": aviso previo al cierre por inactividad. Tocar el botón (o cualquier actividad) lo cancela. */
function AvisoCierre({ hasta, onSeguir }: { hasta: number; onSeguir: () => void }) {
  const [ahora, setAhora] = useState(Date.now());
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    boton.current?.focus();
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seg = Math.max(0, Math.ceil((hasta - ahora) / 1000));
  return (
    <div className="overlay" style={{ zIndex: 40, background: 'rgba(1,1,71,.85)' }} role="alertdialog" aria-modal="true" aria-labelledby="aviso-cierre-t" aria-describedby="aviso-cierre-d">
      <div className="card elevated stack" style={{ maxWidth: 420, gap: 14 }}>
        <h2 id="aviso-cierre-t" className="display" style={{ fontSize: 24 }}>
          ¿Seguís ahí?
        </h2>
        <p id="aviso-cierre-d">
          Por tu privacidad, cerramos la sesión si no hay actividad. Se cierra en <span className="num">{seg}</span> s.
        </p>
        <button ref={boton} type="button" className="btn btn-primary" onClick={onSeguir}>
          Sigo acá
        </button>
      </div>
    </div>
  );
}
