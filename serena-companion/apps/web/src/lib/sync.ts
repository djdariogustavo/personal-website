import { wins, type CheckIn, type Consents, type PullResponse, type PushResult, type SyncMutation, type SyncState } from '@serena/domain';
import { api, isOffline } from './api.ts';
import type { LocalDb } from './localdb.ts';

/**
 * Motor de sincronización offline-first.
 * Todo cambio se escribe primero en la base local cifrada y se encola; la cola
 * se sube cuando hay conexión y luego se bajan los cambios de otros
 * dispositivos con un cursor incremental.
 */

export interface SyncSnapshot {
  estado: SyncState;
  pendientes: number;
  ultimaSync: string | null;
}

type Listener = () => void;
type QueuedMutation = SyncMutation & { encoladaEn: number };

export class SyncEngine {
  private listeners = new Set<Listener>();
  private snapshot: SyncSnapshot = { estado: 'ok', pendientes: 0, ultimaSync: null };
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkinListeners = new Set<Listener>();

  constructor(
    public readonly db: LocalDb,
    private deviceId: string,
  ) {}

  start() {
    const kick = () => void this.sync();
    window.addEventListener('online', kick);
    window.addEventListener('offline', () => this.set({ estado: 'offline' }));
    this.timer = setInterval(kick, 60_000);
    void this.refreshCount().then(kick);
    this.stop = () => {
      window.removeEventListener('online', kick);
      if (this.timer) clearInterval(this.timer);
    };
  }
  stop = () => {};

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  getSnapshot = () => this.snapshot;
  onCheckins(l: Listener): () => void {
    this.checkinListeners.add(l);
    return () => void this.checkinListeners.delete(l);
  }

  private set(p: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...p };
    this.listeners.forEach((l) => l());
  }
  private async refreshCount() {
    const n = (await this.db.all('queue')).length;
    this.set({ pendientes: n, estado: this.snapshot.estado === 'sincronizando' ? 'sincronizando' : !navigator.onLine ? 'offline' : n ? 'pendiente' : 'ok' });
  }

  async checkins(): Promise<CheckIn[]> {
    const all = await this.db.all<CheckIn>('checkins');
    return all.filter((c) => !c.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveCheckin(c: CheckIn) {
    await this.db.put('checkins', c.id, c);
    await this.enqueue({ entity: 'checkin', id: c.id, op: 'upsert', data: c, updatedAt: c.updatedAt });
    this.checkinListeners.forEach((l) => l());
  }

  async saveConsents(c: Consents) {
    await this.enqueue({ entity: 'consents', id: 'consents', op: 'upsert', data: c, updatedAt: new Date().toISOString() });
  }

  private async enqueue(m: Omit<SyncMutation, 'mutationId' | 'deviceId'>) {
    const mutation: QueuedMutation = { ...m, mutationId: crypto.randomUUID(), deviceId: this.deviceId, encoladaEn: Date.now() };
    await this.db.put('queue', mutation.mutationId, mutation);
    await this.refreshCount();
    void this.sync();
  }

  /** Borra el historial local (tras "Borrar mi historial" el servidor manda los tombstones). */
  async wipeCheckins() {
    for (const c of await this.db.all<CheckIn>('checkins')) await this.db.del('checkins', c.id);
    this.checkinListeners.forEach((l) => l());
  }

  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.doSync().finally(() => (this.running = null));
    return this.running;
  }

  private async doSync() {
    if (!navigator.onLine) return this.set({ estado: 'offline' });
    this.set({ estado: 'sincronizando' });
    try {
      // 1) Subir la cola en lotes, en el orden en que se generaron los cambios.
      for (;;) {
        const batch = (await this.db.all<QueuedMutation>('queue')).sort((a, b) => a.encoladaEn - b.encoladaEn).slice(0, 100);
        if (!batch.length) break;
        const r = await api<{ resultados: PushResult[] }>('/sync/push', {
          body: { mutations: batch.map(({ encoladaEn: _e, ...m }) => m) },
        });
        // Aplicada, duplicada, descartada (perdió el conflicto) o rechazada: en todos los casos sale de la cola.
        for (const x of r.resultados) {
          const m = batch.find((b) => b.mutationId === x.mutationId);
          await this.db.del('queue', x.mutationId);
          // Rechazado por consentimiento: el servidor no lo guardó, así que tampoco queda en el equipo.
          if (m?.entity === 'checkin' && x.status === 'rechazada' && (x.motivo === 'consentimiento_retirado' || x.motivo === 'sin_datos_consentidos')) {
            await this.db.del('checkins', m.id);
            this.checkinListeners.forEach((l) => l());
          }
        }
        if (!r.resultados.length) break;
      }
      // 2) Bajar cambios.
      let cursor = (await this.db.get<string>('meta', 'cursor')) ?? '0';
      let changed = false;
      for (;;) {
        const p = await api<PullResponse<CheckIn>>(`/sync/pull?cursor=${encodeURIComponent(cursor)}`);
        for (const ch of p.cambios) {
          const cur = await this.db.get<CheckIn>('checkins', ch.id);
          // Si hay una edición local más nueva todavía en la cola, se conserva.
          if (cur && !wins({ updatedAt: ch.updatedAt, deviceId: ch.deviceId }, { updatedAt: cur.updatedAt, deviceId: cur.deviceId }) && cur.updatedAt !== ch.updatedAt)
            continue;
          if (ch.deleted) await this.db.del('checkins', ch.id);
          else if (ch.data) await this.db.put('checkins', ch.id, { ...ch.data, deviceId: ch.deviceId });
          changed = true;
        }
        cursor = p.cursor;
        await this.db.put('meta', 'cursor', cursor);
        if (!p.hayMas) break;
      }
      if (changed) this.checkinListeners.forEach((l) => l());
      const n = (await this.db.all('queue')).length;
      this.set({ estado: n ? 'pendiente' : 'ok', pendientes: n, ultimaSync: new Date().toISOString() });
    } catch (e) {
      const n = (await this.db.all('queue')).length;
      this.set({ estado: isOffline(e) ? (navigator.onLine ? 'pendiente' : 'offline') : n ? 'pendiente' : 'ok', pendientes: n });
    }
  }

}
