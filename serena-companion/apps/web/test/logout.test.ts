import { describe, expect, it } from 'vitest';
import { MemoryDb } from '../src/lib/localdb.ts';
import { closeLocalData, countPending, logoutMode } from '../src/lib/logout.ts';

async function dbWith(pending: { queue?: number; emergencies?: number; chat?: number }) {
  const db = new MemoryDb();
  await db.put('checkins', 'c1', { id: 'c1' });
  await db.put('meta', 'cursor', '42');
  for (let i = 0; i < (pending.queue ?? 0); i++) await db.put('queue', `q${i}`, { mutationId: `q${i}` });
  for (let i = 0; i < (pending.emergencies ?? 0); i++) await db.put('emergencies', `e${i}`, { id: `e${i}` });
  for (let i = 0; i < (pending.chat ?? 0); i++) await db.put('chatQueue', `m${i}`, { id: `m${i}` });
  return db;
}

describe('cierre de sesión y datos pendientes', () => {
  it('elige el modo según el tipo de cierre', () => {
    expect(logoutMode({ efimera: false })).toBe('retain_pending');
    expect(logoutMode({ efimera: false, reason: 'sesion_inactividad' })).toBe('retain_pending');
    expect(logoutMode({ efimera: false, reason: 'sesion_bloqueada' })).toBe('retain_pending');
    expect(logoutMode({ efimera: true })).toBe('destroy'); // kiosco
    expect(logoutMode({ efimera: false, reason: 'sesion_cerrada' })).toBe('destroy'); // cierre remoto
    expect(logoutMode({ efimera: false, wipe: true })).toBe('destroy');
  });

  it('conserva check-ins, avisos de emergencia y mensajes sin enviar, y descarta el resto', async () => {
    const db = await dbWith({ queue: 2, emergencies: 1, chat: 1 });
    expect(await countPending(db)).toBe(4);
    const kept = await closeLocalData(db, 'retain_pending');
    expect(kept).toBe(4);
    expect(await db.all('queue')).toHaveLength(2);
    expect(await db.all('emergencies')).toHaveLength(1);
    expect(await db.all('chatQueue')).toHaveLength(1);
    expect(await db.all('checkins')).toHaveLength(0);
    expect(await db.get('meta', 'cursor')).toBeUndefined();
  });

  it('sin pendientes borra todo', async () => {
    const db = await dbWith({});
    expect(await closeLocalData(db, 'retain_pending')).toBe(0);
    expect(await db.all('checkins')).toHaveLength(0);
  });

  it('en kiosco o cierre remoto borra todo aunque haya pendientes', async () => {
    const db = await dbWith({ queue: 3, emergencies: 1 });
    expect(await closeLocalData(db, 'destroy')).toBe(0);
    expect(await countPending(db)).toBe(0);
  });
});
