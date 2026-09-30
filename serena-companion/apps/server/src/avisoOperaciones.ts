/**
 * Avisos a quien opera SERENA (no a la guardia ni a las personas): fallas que afectan a todos y que no se
 * resuelven solas, como una cuenta de Twilio que rechaza todos los SMS. Van por email con Resend, por su API
 * REST y sin SDK, igual que Twilio (funciona en Node y en Workers).
 *
 * Una misma falla se repite con cada intento de ingreso: se avisa una vez por clave cada VENTANA_AVISO_MS para
 * no llenar la casilla. El envío nunca bloquea ni hace fallar la operación que lo originó.
 *
 * Los avisos no llevan datos personales: ni teléfonos completos, ni códigos, ni nombres.
 */

export const VENTANA_AVISO_MS = 60 * 60_000;

export interface AvisoOperaciones {
  /** clave: identifica la falla (p. ej. "twilio:21608") para no repetir el aviso dentro de la ventana. */
  avisar(clave: string, asunto: string, texto: string): void;
}

export interface ConfigResend {
  apiKey: string;
  /** Remitente con dominio verificado en Resend, p. ej. "SERENA <alertas@serena.app>". */
  from: string;
  to: string[];
}

export class ResendAvisoOperaciones implements AvisoOperaciones {
  private readonly ultimos = new Map<string, number>();

  constructor(
    private readonly cfg: ConfigResend,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ahora: () => number = Date.now,
  ) {}

  avisar(clave: string, asunto: string, texto: string): void {
    const t = this.ahora();
    const previo = this.ultimos.get(clave);
    if (previo !== undefined && t - previo < VENTANA_AVISO_MS) return;
    this.ultimos.set(clave, t);
    void this.enviar(asunto, texto).then(
      (ok) => {
        // Si no salió, se permite reintentar con la próxima ocurrencia de la falla.
        if (!ok) this.ultimos.delete(clave);
      },
      () => this.ultimos.delete(clave),
    );
  }

  /** Envía el email; devuelve si Resend lo aceptó. Nunca lanza. */
  async enviar(asunto: string, texto: string): Promise<boolean> {
    try {
      const r = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.cfg.from, to: this.cfg.to, subject: `[SERENA] ${asunto}`, text: texto }),
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) return true;
      const err = (await r.json().catch(() => null)) as { name?: string; message?: string } | null;
      // Resend siempre responde sus errores en JSON con name y message. Sin ellos, la respuesta no vino de Resend:
      // suele ser un proxy o un firewall de salida que bloquea api.resend.com.
      if (err?.name || err?.message) console.error(`[serena][alertas] Resend rechazó el aviso por email (HTTP ${r.status}, ${err.name ?? '—'}: ${err.message ?? '—'})`);
      else console.error(`[serena][alertas] El aviso por email no llegó a Resend (HTTP ${r.status} sin respuesta de Resend): revisar que la red permita salir a api.resend.com.`);
      return false;
    } catch (e) {
      console.error('[serena][alertas] Resend no respondió:', (e as Error).name);
      return false;
    }
  }
}

/** Configuración mínima para avisar por email; null si falta algo (entonces los avisos quedan solo en los registros). */
export function avisoOperaciones(c: { resendApiKey: string | null; from: string | null; to: string | null }): AvisoOperaciones | null {
  const to = (c.to ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!c.resendApiKey || !c.from || !to.length) return null;
  return new ResendAvisoOperaciones({ apiKey: c.resendApiKey, from: c.from, to });
}
