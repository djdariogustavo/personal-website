import type { EmergencyAck, EmergencyRequest } from '@serena/domain';
import { api, isOffline } from './api.ts';
import type { LocalDb } from './localdb.ts';

/**
 * Cola de avisos a la guardia. Sin señal, el aviso se guarda y se reintenta
 * cada 10 s hasta que el servidor confirma. El id se genera en el dispositivo,
 * así los reintentos nunca duplican el aviso.
 */

export type EmergencyStatus = { estado: 'en_cola'; req: EmergencyRequest } | { estado: 'enviado'; req: EmergencyRequest; ack: EmergencyAck };

type Listener = (s: EmergencyStatus) => void;

export class EmergencyQueue {
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();

  constructor(private db: LocalDb) {}

  start() {
    this.timer = setInterval(() => void this.flush(), 10_000);
    window.addEventListener('online', this.onOnline);
    void this.flush();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    window.removeEventListener('online', this.onOnline);
  }
  private onOnline = () => void this.flush();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  async send(req: EmergencyRequest): Promise<EmergencyStatus> {
    await this.db.put('emergencies', req.id, req);
    return this.trySend(req);
  }

  private async trySend(req: EmergencyRequest): Promise<EmergencyStatus> {
    try {
      const ack = await api<EmergencyAck>('/emergency', { body: req, timeoutMs: 10_000 });
      await this.db.del('emergencies', req.id);
      const s: EmergencyStatus = { estado: 'enviado', req, ack };
      this.listeners.forEach((l) => l(s));
      return s;
    } catch (e) {
      if (!isOffline(e)) console.error('No se pudo enviar el aviso', e);
      return { estado: 'en_cola', req };
    }
  }

  async pending(): Promise<EmergencyRequest[]> {
    return this.db.all<EmergencyRequest>('emergencies');
  }

  async flush() {
    for (const r of await this.pending()) await this.trySend(r);
  }
}

/**
 * Posición actual si la persona eligió compartirla. Nunca demora el aviso más
 * de 8 s: el `timeout` de la API no corre mientras el permiso está pendiente,
 * así que se agrega un tope propio. Sin ubicación, el aviso sale igual.
 */
export function currentPosition(maxMs = 8000): Promise<EmergencyRequest['ubicacion']> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: EmergencyRequest['ubicacion']) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(v);
    };
    const t = setTimeout(() => finish(null), maxMs);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude, precisionM: Math.round(p.coords.accuracy) }),
        () => finish(null),
        { enableHighAccuracy: true, timeout: maxMs, maximumAge: 60_000 },
      );
    } catch {
      finish(null);
    }
  });
}
