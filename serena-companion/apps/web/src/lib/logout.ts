import type { LocalDb, StoreName } from './localdb.ts';

/**
 * Qué pasa con los datos del dispositivo al cerrar la sesión.
 *
 * Lo que todavía no llegó al servidor (check-ins en cola, avisos de emergencia
 * y mensajes del chat sin enviar) NUNCA se descarta en silencio: queda cifrado
 * en el equipo y se sube en el próximo ingreso de la misma persona. Se borra
 * todo solo cuando ese es el objetivo del cierre:
 * - kiosco (sesión efímera: el equipo no conserva datos de nadie);
 * - cierre remoto desde "Dispositivos" (equipo perdido o ajeno);
 * - reinicio explícito (vista previa).
 */

export const PENDING_STORES: StoreName[] = ['queue', 'emergencies', 'chatQueue'];
const CACHE_STORES: StoreName[] = ['checkins', 'meta'];

export type LogoutMode = 'destroy' | 'retain_pending';

export function logoutMode(opts: { efimera: boolean; reason?: string; wipe?: boolean }): LogoutMode {
  if (opts.wipe || opts.efimera || opts.reason === 'sesion_cerrada') return 'destroy';
  return 'retain_pending';
}

export async function countPending(db: LocalDb): Promise<number> {
  const counts = await Promise.all(PENDING_STORES.map((s) => db.all(s).then((x) => x.length)));
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Cierra la base local según el modo. Devuelve cuántos registros pendientes
 * quedaron guardados (0 si se borró todo o no había pendientes).
 */
export async function closeLocalData(db: LocalDb, mode: LogoutMode): Promise<number> {
  if (mode === 'destroy') {
    await db.destroy();
    return 0;
  }
  const pending = await countPending(db);
  if (pending === 0) {
    await db.destroy();
    return 0;
  }
  // Se conserva solo lo pendiente; el historial ya está en el servidor y se vuelve a bajar al ingresar.
  await db.clearStores(CACHE_STORES);
  await db.close();
  return pending;
}

/** Espera una promesa como máximo `ms`; nunca rechaza. */
export function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    p.then(
      () => (clearTimeout(t), resolve()),
      () => (clearTimeout(t), resolve()),
    );
  });
}
