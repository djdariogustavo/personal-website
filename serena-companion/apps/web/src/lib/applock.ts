/**
 * Bloqueo local de la app en el teléfono personal (6.3): PIN de 4 dígitos y,
 * si el sistema lo ofrece, huella o rostro mediante WebAuthn (autenticador de
 * plataforma con verificación de usuario). Es un DESBLOQUEO LOCAL: no
 * reemplaza al ingreso con contraseña y segundo factor. El PIN nunca sale del
 * dispositivo; se guarda derivado con PBKDF2-SHA256 (310 000 iteraciones).
 */

const KEY = 'serena.applock';
const MAX_INTENTOS = 5;

interface LockData {
  salt: string;
  hash: string;
  credId?: string;
  intentos: number;
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 310_000 }, base, 256);
  return b64(bits);
}

function read(): LockData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockData) : null;
  } catch {
    return null;
  }
}
function write(d: LockData | null) {
  try {
    if (d) localStorage.setItem(KEY, JSON.stringify(d));
    else localStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export const appLock = {
  configured: () => read() !== null,
  hasBiometric: () => Boolean(read()?.credId),

  async setPin(pin: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    write({ salt: b64(salt), hash: await derive(pin, salt), intentos: 0 });
  },

  /** Devuelve 'ok', 'incorrecto' o 'bloqueado' (tras 5 intentos se exige volver a ingresar). */
  async verify(pin: string): Promise<'ok' | 'incorrecto' | 'bloqueado'> {
    const d = read();
    if (!d) return 'bloqueado';
    if ((await derive(pin, unb64(d.salt))) === d.hash) {
      write({ ...d, intentos: 0 });
      return 'ok';
    }
    const intentos = d.intentos + 1;
    if (intentos >= MAX_INTENTOS) {
      write(null);
      return 'bloqueado';
    }
    write({ ...d, intentos });
    return 'incorrecto';
  },

  clear() {
    write(null);
  },

  async biometricAvailable(): Promise<boolean> {
    try {
      return Boolean(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
    } catch {
      return false;
    }
  },

  async enrollBiometric(userId: string, nombre: string): Promise<boolean> {
    const d = read();
    if (!d) return false;
    try {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'SERENA Companion' },
          user: { id: new TextEncoder().encode(userId), name: nombre, displayName: nombre },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;
      if (!cred) return false;
      write({ ...d, credId: b64(cred.rawId) });
      return true;
    } catch {
      return false;
    }
  },

  async unlockBiometric(): Promise<boolean> {
    const d = read();
    if (!d?.credId) return false;
    try {
      const a = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: unb64(d.credId) as BufferSource }],
          userVerification: 'required',
          timeout: 60_000,
        },
      });
      return Boolean(a);
    } catch {
      return false;
    }
  },
};
