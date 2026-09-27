/**
 * Cliente HTTP de la API. Distingue "sin conexión" (el pedido no llegó) de un
 * error del servidor, porque la app es offline-first y cada caso se trata distinto.
 */

export class OfflineError extends Error {
  constructor() {
    super('sin_conexion');
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public mensaje: string,
  ) {
    super(mensaje || code);
  }
}

let token: string | null = null;
let onSessionEnded: ((code: string) => void) | null = null;

export function setToken(t: string | null) {
  token = t;
}
export function getToken() {
  return token;
}
export function onSessionEnd(fn: (code: string) => void) {
  onSessionEnded = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; raw?: boolean; timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    });
  } catch {
    throw new OfflineError();
  }
  if (init.raw && res.ok) return res as unknown as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* cuerpo vacío */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; mensaje?: string };
    const code = d.error ?? `http_${res.status}`;
    if (res.status === 401 && token && code.startsWith('sesion')) onSessionEnded?.(code);
    // 502/503/504 del proxy o de la red satelital: se trata como sin conexión.
    if (res.status >= 502 && res.status <= 504) throw new OfflineError();
    throw new ApiError(res.status, code, d.mensaje ?? '');
  }
  return data as T;
}

export function isOffline(e: unknown): e is OfflineError {
  return e instanceof OfflineError;
}
