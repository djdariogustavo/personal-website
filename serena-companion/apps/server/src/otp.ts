import type { AppContext } from './context.ts';
import type { OtpProposito } from './notify.ts';
import { HttpError } from './auth.ts';
import { newOtp, sha256 } from './crypto.ts';
import { SmsNoEnviado } from './sms/twilio.ts';

/**
 * Códigos de un solo uso (ingreso y recuperación), con o sin un proveedor que los genere.
 *
 * - Sin proveedor: SERENA genera el código, guarda sha256(desafío:código) y lo entrega por SMS.
 * - Con Twilio Verify: Twilio genera, entrega y valida el código. SERENA guarda un marcador en lugar
 *   del hash y, cuando Twilio aprueba un código, guarda su hash: así un reintento con el mismo código
 *   (p. ej. tras elegir una contraseña que no cumple la política) no depende de Twilio, que ya lo consumió.
 */

export const CODIGO_EXTERNO = 'proveedor';

/** Código nuevo para un desafío: el hash a guardar y el código, que es null si lo genera el proveedor. */
export function nuevoCodigo(ctx: AppContext, desafioId: string): { codeHash: string; code: string | null } {
  if (ctx.messenger.verificador) return { codeHash: CODIGO_EXTERNO, code: null };
  const code = newOtp();
  return { codeHash: sha256(`${desafioId}:${code}`), code };
}

export async function entregarCodigo(ctx: AppContext, to: { telefono: string | null; email: string | null }, code: string | null, proposito: OtpProposito): Promise<void> {
  const v = ctx.messenger.verificador;
  if (v) return v.enviar(to.telefono, proposito);
  if (code === null) throw new Error('Falta el código a entregar.');
  return ctx.messenger.sendOtp(to, code, proposito);
}

/**
 * Demora similar a una consulta a Twilio Verify. Para un desafío sin cuenta no se consulta a nadie; sin esta
 * espera, la respuesta más rápida revelaría que la cuenta no existe.
 */
export function demoraComoProveedor(ctx: AppContext): Promise<void> {
  if (!ctx.messenger.verificador) return Promise.resolve();
  return new Promise((listo) => setTimeout(listo, 150 + Math.random() * 250));
}

export async function codigoValido(
  ctx: AppContext,
  tabla: 'login_challenges' | 'password_resets',
  desafio: { id: string; code_hash: string },
  telefono: string | null,
  codigo: string,
): Promise<boolean> {
  const local = sha256(`${desafio.id}:${codigo}`);
  if (desafio.code_hash === local) return true;
  const v = ctx.messenger.verificador;
  if (desafio.code_hash !== CODIGO_EXTERNO || !v) return false;
  let aprobado: boolean;
  try {
    aprobado = await v.comprobar(telefono, codigo);
  } catch (e) {
    if (e instanceof SmsNoEnviado)
      throw e.motivo === 'cuenta'
        ? new HttpError(503, 'verificacion_no_disponible', 'La validación de códigos no está disponible en este momento y ya lo estamos revisando. Mientras tanto, pedí ayuda a salud ocupacional de tu faena.')
        : new HttpError(502, 'verificacion_no_disponible', 'No pudimos validar el código en este momento. Probá de nuevo en un minuto.');
    throw e;
  }
  if (aprobado) ctx.db.prepare(`UPDATE ${tabla} SET code_hash = ? WHERE id = ? AND code_hash = ?`).run(local, desafio.id, CODIGO_EXTERNO);
  return aprobado;
}
