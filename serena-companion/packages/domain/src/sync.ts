/**
 * Sincronización offline-first (anexo técnico, "Sincronización").
 *
 * - Cada dispositivo guarda sus cambios en una base local cifrada y los encola.
 * - Al volver la conexión se suben en orden (push) y se baja lo nuevo (pull)
 *   con un cursor incremental.
 * - Conflictos: gana la versión con `updatedAt` más reciente; si empatan, se
 *   desempata por id de dispositivo de origen (orden lexicográfico estable),
 *   para que todos los dispositivos converjan al mismo estado.
 */

export type SyncEntity = 'checkin' | 'consents' | 'chat';

export interface SyncMutation<T = unknown> {
  /** Id de la mutación (para idempotencia). */
  mutationId: string;
  entity: SyncEntity;
  /** Id del registro afectado. */
  id: string;
  op: 'upsert' | 'delete';
  data: T | null;
  updatedAt: string;
  deviceId: string;
}

export interface Versioned {
  updatedAt: string;
  deviceId: string;
}

/** true si `incoming` debe reemplazar a `current`. */
export function wins(incoming: Versioned, current: Versioned | null | undefined): boolean {
  if (!current) return true;
  const a = Date.parse(incoming.updatedAt);
  const b = Date.parse(current.updatedAt);
  if (a !== b) return a > b;
  return incoming.deviceId > current.deviceId;
}

export interface PushResult {
  mutationId: string;
  status: 'aplicada' | 'descartada' | 'duplicada' | 'rechazada';
  motivo?: string;
}

export interface PullResponse<T = unknown> {
  cursor: string;
  cambios: Array<{ entity: SyncEntity; id: string; deleted: boolean; data: T | null; updatedAt: string; deviceId: string }>;
  hayMas: boolean;
}
