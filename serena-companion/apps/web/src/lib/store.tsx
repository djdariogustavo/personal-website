import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_CONFIG, type Consents, type DeviceKind, type RemoteConfig, type UserProfile } from '@serena/domain';
import { api, onSessionEnd, setToken } from './api.ts';
import { openLocalDb, type LocalDb } from './localdb.ts';
import { SyncEngine, type SyncSnapshot } from './sync.ts';
import { EmergencyQueue } from './emergency.ts';
import { appLock } from './applock.ts';

/**
 * Estado global de la app: configuración remota, sesión, base local cifrada,
 * sincronización, cola de emergencias, bloqueo local y tema.
 */

export type Profile = UserProfile & { consentimientoOtorgado?: boolean };

export interface Session {
  token: string;
  deviceId: string;
  deviceKind: DeviceKind;
  efimera: boolean;
  perfil: Profile;
  trustToken?: string;
}

interface Ctx {
  config: RemoteConfig;
  session: Session | null;
  ready: boolean;
  engine: SyncEngine | null;
  emergencies: EmergencyQueue | null;
  locked: boolean;
  sessionEnded: string | null;
  theme: 'noche' | 'sol';
  setTheme(t: 'noche' | 'sol'): void;
  startSession(s: Session): Promise<void>;
  endSession(opts?: { reason?: string; remote?: boolean }): Promise<void>;
  clearSessionEnded(): void;
  setProfile(p: Profile): void;
  unlock(): void;
  lock(): void;
  pendingConsents: Consents | null;
  setPendingConsents(c: Consents | null): void;
}

const AppCtx = createContext<Ctx | null>(null);

const LS = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* sin almacenamiento */
    }
  },
};

export const storage = LS;

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<RemoteConfig>(() => LS.get<RemoteConfig>('serena.config') ?? DEFAULT_CONFIG);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [local, setLocal] = useState<{ db: LocalDb; engine: SyncEngine; emergencies: EmergencyQueue } | null>(null);
  const [locked, setLocked] = useState(false);
  const [sessionEnded, setSessionEnded] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'noche' | 'sol'>(() => LS.get('serena.theme') ?? 'noche');
  const [pendingConsents, setPendingConsentsState] = useState<Consents | null>(() => LS.get('serena.consent.pending'));
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    LS.set('serena.theme', theme);
  }, [theme]);

  useEffect(() => {
    api<RemoteConfig>('/config')
      .then((c) => {
        setConfig(c);
        LS.set('serena.config', c);
      })
      .catch(() => undefined);
  }, []);

  const attachLocal = useCallback(async (s: Session) => {
    const db = await openLocalDb(s.perfil.id, s.efimera);
    const engine = new SyncEngine(db, s.deviceId);
    const emergencies = new EmergencyQueue(db);
    engine.start();
    emergencies.start();
    setLocal({ db, engine, emergencies });
  }, []);

  const detachLocal = useCallback(async (destroy: boolean) => {
    const l = localRef.current;
    if (!l) return;
    l.engine.stop();
    l.emergencies.stop();
    if (destroy) await l.db.destroy();
    setLocal(null);
  }, []);

  // Restaurar sesión guardada (nunca en kiosco).
  useEffect(() => {
    const saved = LS.get<Session>('serena.session');
    if (saved && !saved.efimera) {
      setToken(saved.token);
      setSession(saved);
      if (saved.deviceKind === 'mobile' && appLock.configured()) setLocked(true);
      void attachLocal(saved).finally(() => setReady(true));
      api<{ perfil: Profile }>('/me')
        .then(({ perfil }) => {
          setSession((cur) => (cur ? { ...cur, perfil } : cur));
          LS.set('serena.session', { ...saved, perfil });
        })
        .catch(() => undefined);
    } else setReady(true);
  }, [attachLocal]);

  const endSession = useCallback(
    async (opts: { reason?: string; remote?: boolean } = {}) => {
      const s = LS.get<Session>('serena.session');
      if (opts.remote !== false) await api('/auth/logout', { body: {} }).catch(() => undefined);
      setToken(null);
      LS.set('serena.session', null);
      // Kiosco: no queda nada. Personal: se borra la base local (los datos están en el servidor).
      await detachLocal(true);
      if (s?.deviceKind === 'mobile') appLock.clear();
      setSession(null);
      setLocked(false);
      if (opts.reason) setSessionEnded(opts.reason);
    },
    [detachLocal],
  );

  useEffect(() => {
    onSessionEnd((code) => void endSession({ reason: code, remote: false }));
  }, [endSession]);

  const startSession = useCallback(
    async (s: Session) => {
      setToken(s.token);
      setSession(s);
      setSessionEnded(null);
      LS.set('serena.lastKind', s.deviceKind);
      if (!s.efimera) LS.set('serena.session', s);
      if (s.trustToken) LS.set('serena.trust', { token: s.trustToken, deviceId: s.deviceId });
      await attachLocal(s);
    },
    [attachLocal],
  );

  const setProfile = useCallback((perfil: Profile) => {
    setSession((cur) => {
      if (!cur) return cur;
      const next = { ...cur, perfil };
      if (!next.efimera) LS.set('serena.session', next);
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      config,
      session,
      ready,
      engine: local?.engine ?? null,
      emergencies: local?.emergencies ?? null,
      locked,
      sessionEnded,
      theme,
      setTheme: setThemeState,
      startSession,
      endSession,
      clearSessionEnded: () => setSessionEnded(null),
      setProfile,
      unlock: () => setLocked(false),
      lock: () => setLocked(true),
      pendingConsents,
      setPendingConsents: (c) => {
        setPendingConsentsState(c);
        LS.set('serena.consent.pending', c);
      },
    }),
    [config, session, ready, local, locked, sessionEnded, theme, startSession, endSession, setProfile, pendingConsents],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
}

const offlineSnapshot: SyncSnapshot = { estado: 'offline', pendientes: 0, ultimaSync: null };
const noop = () => () => undefined;

export function useSync(): SyncSnapshot {
  const { engine } = useApp();
  const online = useOnline();
  const snap = useSyncExternalStore(engine?.subscribe ?? noop, engine?.getSnapshot ?? (() => offlineSnapshot));
  if (!online) return { ...snap, estado: 'offline' };
  return snap;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

/** Check-ins locales, actualizados cuando cambia la base. */
export function useCheckins() {
  const { engine } = useApp();
  const [list, setList] = useState<Awaited<ReturnType<SyncEngine['checkins']>>>([]);
  useEffect(() => {
    if (!engine) return;
    let alive = true;
    const load = () => void engine.checkins().then((l) => alive && setList(l));
    load();
    const off = engine.onCheckins(load);
    return () => {
      alive = false;
      off();
    };
  }, [engine]);
  return list;
}
