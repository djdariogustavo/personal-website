import type { AvisoOperaciones } from './avisoOperaciones.ts';

/**
 * Tokens de corta duración para el SDK de escaneo (Shen.AI, API de administración).
 *
 * En lugar de compilar la clave permanente dentro de la app (cualquiera que la descargue la puede leer), el servidor
 * pide al proveedor un token por escaneo con la credencial de administración, que nunca sale del servidor:
 *
 *   POST https://api.shen.ai/v1/token   Authorization: Bearer <credencial con el permiso tokens:generate>
 *   { "expires_in": 60–86400, "single_device": true, "max_measurements": n }  →  { "token": "sh_…", "expires_at": ISO }
 *
 * El token se pasa a initialize() del SDK en lugar de la clave (developer.shen.ai/admin-api/short-term-tokens).
 * No se pueden revocar uno por uno: por eso el TTL es corto y cada token queda atado al primer dispositivo que lo usa.
 */

export interface ConfigTokensEscaneo {
  /** Credencial de administración del proveedor (permiso tokens:generate). */
  adminKey: string;
  /** Vida del token en segundos (60 a 86.400). Por defecto 15 minutos: alcanza para un check-in con reintentos. */
  ttlS?: number;
  /** Mediciones permitidas por token. Por defecto 3 (la medición y dos reintentos). */
  maxMediciones?: number;
  /** Licencia a usar si la cuenta tiene varias; por defecto la primera activa. */
  licenseId?: number;
  url?: string;
  fetch?: typeof fetch;
  aviso?: AvisoOperaciones | null;
}

export interface TokenEscaneo {
  token: string;
  /** ISO 8601 (UTC). */
  expiraEn: string;
}

export class ErrorTokenEscaneo extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
  ) {
    super(`Shen.AI respondió ${estado} ${codigo}`);
  }
}

export const TTL_POR_DEFECTO_S = 900;
export const MAX_MEDICIONES_POR_DEFECTO = 3;
const TOPE_MS = 10_000;

export class EmisorTokensEscaneo {
  private readonly ttlS: number;
  private readonly maxMediciones: number;
  private readonly url: string;
  private readonly f: typeof fetch;

  constructor(private readonly cfg: ConfigTokensEscaneo) {
    this.ttlS = Math.min(86_400, Math.max(60, Math.round(cfg.ttlS ?? TTL_POR_DEFECTO_S)));
    this.maxMediciones = Math.max(1, Math.round(cfg.maxMediciones ?? MAX_MEDICIONES_POR_DEFECTO));
    this.url = cfg.url ?? 'https://api.shen.ai/v1/token';
    this.f = cfg.fetch ?? fetch;
  }

  async emitir(): Promise<TokenEscaneo> {
    const cuerpo: Record<string, unknown> = { expires_in: this.ttlS, single_device: true, max_measurements: this.maxMediciones };
    if (this.cfg.licenseId !== undefined) cuerpo.license_id = this.cfg.licenseId;
    let res: Response;
    try {
      res = await this.f(this.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.adminKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TOPE_MS),
      });
    } catch (e) {
      console.error(`[serena][escaneo] No se pudo pedir el token al proveedor: ${e instanceof Error ? e.message : String(e)}`);
      throw new ErrorTokenEscaneo(0, 'SIN_CONEXION');
    }
    const datos = (await res.json().catch(() => null)) as { token?: unknown; expires_at?: unknown; code?: unknown; error?: unknown } | null;
    if (!res.ok) {
      const codigo = String(datos?.code ?? datos?.error ?? 'DESCONOCIDO').replace(/[^A-Z_]/gi, '').slice(0, 40) || 'DESCONOCIDO';
      console.error(`[serena][escaneo][ALERTA] El proveedor rechazó el pedido de token: HTTP ${res.status} ${codigo}`);
      // 401/403: credencial vencida, rotada o sin el permiso. Nadie puede escanear hasta corregirla.
      if (res.status === 401 || res.status === 403)
        this.cfg.aviso?.avisar(
          `shenai:${res.status}`,
          'SERENA · El escaneo quedó sin licencia',
          `El proveedor del escaneo (Shen.AI) rechazó la credencial de administración (HTTP ${res.status} ${codigo}). ` +
            'Revisar SHENAI_ADMIN_KEY en Render: tiene que estar vigente y tener el permiso tokens:generate. ' +
            'Mientras tanto, los check-ins siguen sin escaneo.',
        );
      throw new ErrorTokenEscaneo(res.status, codigo);
    }
    if (typeof datos?.token !== 'string' || !/^sh_[0-9a-f]{16,}$/i.test(datos.token)) {
      console.error('[serena][escaneo][ALERTA] Respuesta de token del proveedor con formato inesperado.');
      throw new ErrorTokenEscaneo(res.status, 'RESPUESTA_INVALIDA');
    }
    const expira = typeof datos.expires_at === 'string' && !Number.isNaN(Date.parse(datos.expires_at)) ? datos.expires_at : new Date(Date.now() + this.ttlS * 1000).toISOString();
    return { token: datos.token, expiraEn: expira };
  }
}
