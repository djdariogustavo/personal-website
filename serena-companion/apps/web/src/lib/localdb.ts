/**
 * Base local cifrada (offline-first).
 *
 * - IndexedDB por usuario: `serena-<userId>`.
 * - Cada valor se guarda cifrado con AES-GCM (256 bits). La clave se genera en
 *   el dispositivo como CryptoKey NO extraíble y se guarda en la misma base: el
 *   navegador no permite leer su material, solo usarla desde este origen.
 *   Límite: quien pueda ejecutar código en este origen (p. ej. con el equipo
 *   desbloqueado y las herramientas de desarrollo) puede usarla. Es una capa de
 *   defensa, no una bóveda; ver docs/SEGURIDAD-Y-CIFRADO.md §2.
 * - En el kiosco se usa una base en memoria: al cerrar la sesión no queda nada.
 */

export type StoreName = 'checkins' | 'queue' | 'meta' | 'emergencies' | 'chatQueue';
const STORES: StoreName[] = ['checkins', 'queue', 'meta', 'emergencies', 'chatQueue'];

export interface LocalDb {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put<T>(store: StoreName, key: string, value: T): Promise<void>;
  del(store: StoreName, key: string): Promise<void>;
  all<T>(store: StoreName): Promise<T[]>;
  clear(): Promise<void>;
  /** Vacía solo las colecciones indicadas. */
  clearStores(stores: StoreName[]): Promise<void>;
  /** Cierra la conexión sin borrar nada. */
  close(): Promise<void>;
  destroy(): Promise<void>;
}

export class MemoryDb implements LocalDb {
  private data = new Map<StoreName, Map<string, unknown>>(STORES.map((s) => [s, new Map()]));
  async get<T>(s: StoreName, k: string) {
    return structuredClone(this.data.get(s)!.get(k)) as T | undefined;
  }
  async put<T>(s: StoreName, k: string, v: T) {
    this.data.get(s)!.set(k, structuredClone(v));
  }
  async del(s: StoreName, k: string) {
    this.data.get(s)!.delete(k);
  }
  async all<T>(s: StoreName) {
    return [...this.data.get(s)!.values()].map((v) => structuredClone(v)) as T[];
  }
  async clear() {
    for (const m of this.data.values()) m.clear();
  }
  async clearStores(stores: StoreName[]) {
    for (const s of stores) this.data.get(s)!.clear();
  }
  async close() {}
  async destroy() {
    await this.clear();
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

interface Sealed {
  iv: Uint8Array;
  ct: ArrayBuffer;
}

export class EncryptedIdb implements LocalDb {
  private constructor(
    private db: IDBDatabase,
    private key: CryptoKey,
    private name: string,
  ) {}

  static async open(userId: string): Promise<EncryptedIdb> {
    const name = `serena-${userId}`;
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      for (const s of [...STORES, 'keys']) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s);
    };
    const db = await req(open);
    let key = await req(db.transaction('keys').objectStore('keys').get('data')) as CryptoKey | undefined;
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await req(db.transaction('keys', 'readwrite').objectStore('keys').put(key, 'data'));
    }
    return new EncryptedIdb(db, key, name);
  }

  private async seal(v: unknown): Promise<Sealed> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, new TextEncoder().encode(JSON.stringify(v)));
    return { iv, ct };
  }
  private async open<T>(s: Sealed): Promise<T> {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv as BufferSource }, this.key, s.ct);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  }

  async get<T>(store: StoreName, key: string) {
    const s = (await req(this.db.transaction(store).objectStore(store).get(key))) as Sealed | undefined;
    return s ? this.open<T>(s) : undefined;
  }
  async put<T>(store: StoreName, key: string, value: T) {
    const sealed = await this.seal(value);
    await req(this.db.transaction(store, 'readwrite').objectStore(store).put(sealed, key));
  }
  async del(store: StoreName, key: string) {
    await req(this.db.transaction(store, 'readwrite').objectStore(store).delete(key));
  }
  async all<T>(store: StoreName) {
    const rows = (await req(this.db.transaction(store).objectStore(store).getAll())) as Sealed[];
    return Promise.all(rows.map((r) => this.open<T>(r)));
  }
  async clear() {
    const tx = this.db.transaction(STORES, 'readwrite');
    await Promise.all(STORES.map((s) => req(tx.objectStore(s).clear())));
  }
  async clearStores(stores: StoreName[]) {
    const tx = this.db.transaction(stores, 'readwrite');
    await Promise.all(stores.map((s) => req(tx.objectStore(s).clear())));
  }
  async close() {
    this.db.close();
  }
  async destroy() {
    this.db.close();
    await req(indexedDB.deleteDatabase(this.name)).catch(() => undefined);
  }
}

export async function openLocalDb(userId: string, ephemeral: boolean): Promise<LocalDb> {
  if (ephemeral || typeof indexedDB === 'undefined') return new MemoryDb();
  try {
    return await EncryptedIdb.open(userId);
  } catch {
    // Navegación privada o IndexedDB bloqueado: se trabaja en memoria.
    return new MemoryDb();
  }
}
