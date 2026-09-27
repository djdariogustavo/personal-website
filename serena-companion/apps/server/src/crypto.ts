import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Criptografía del servidor.
 * - Contraseñas y PIN: scrypt (N=2^15, r=8, p=1) con sal aleatoria.
 * - Datos en reposo: AES-256-GCM con una clave por usuario derivada por HKDF-SHA256
 *   de la clave maestra y el id del usuario. Borrar a un usuario (o rotar su
 *   sal) vuelve ilegibles sus datos aun en copias de respaldo.
 * - Códigos de un solo uso y tokens: se guarda solo su hash.
 */

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(secret, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(expected, actual);
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function hmacHex(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const newId = () => randomUUID();
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export class Vault {
  private readonly master: Buffer;
  constructor(masterKeyB64: string) {
    this.master = Buffer.from(masterKeyB64, 'base64');
    if (this.master.length !== 32) throw new Error('SERENA_MASTER_KEY debe ser de 32 bytes en base64');
  }

  private keyFor(userId: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.master, Buffer.from(userId), Buffer.from('serena/v1/user-data'), 32));
  }

  encrypt(userId: string, value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keyFor(userId), iv);
    cipher.setAAD(Buffer.from(userId));
    const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64')}.${ct.toString('base64')}.${cipher.getAuthTag().toString('base64')}`;
  }

  decrypt<T>(userId: string, blob: string): T {
    const [v, ivB64, ctB64, tagB64] = blob.split('.');
    if (v !== 'v1' || !ivB64 || !ctB64 || !tagB64) throw new Error('Formato de cifrado desconocido');
    const decipher = createDecipheriv('aes-256-gcm', this.keyFor(userId), Buffer.from(ivB64, 'base64'));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as T;
  }
}
