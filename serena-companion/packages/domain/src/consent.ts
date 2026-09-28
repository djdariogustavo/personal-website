/**
 * Aplicación del consentimiento a un check-in (6.2 / 6.14).
 *
 * Cada permiso cubre datos concretos. Si un permiso está apagado, esos datos
 * no se procesan ni se guardan, aunque lleguen desde un dispositivo que todavía
 * no se enteró del cambio (por ejemplo, un check-in hecho sin señal antes de
 * apagar el permiso en otro equipo). Se aplica el consentimiento VIGENTE al
 * momento de procesar: retirar un permiso detiene el procesamiento desde ese
 * momento, incluido lo que estaba en cola.
 *
 * - camara   → escaneo (valores fisiológicos)
 * - animo    → autorreporte de ánimo y sueño, y la nota libre
 * - reaccion → prueba de reacción y lectura en voz alta
 * - chat y geo no forman parte del check-in (se aplican en sus propias rutas).
 */
import type { CheckIn, Consents } from './types.ts';

export type ConsentDecision =
  | { ok: true; checkin: CheckIn; quitados: Array<keyof Consents> }
  | { ok: false; motivo: 'consentimiento_retirado' | 'sin_datos_consentidos' };

export function applyConsents(c: CheckIn, consents: Consents, otorgado = true): ConsentDecision {
  if (!otorgado) return { ok: false, motivo: 'consentimiento_retirado' };
  const out: CheckIn = { ...c };
  const quitados: Array<keyof Consents> = [];
  if (!consents.camara && out.escaneo) {
    out.escaneo = null;
    quitados.push('camara');
  }
  if (!consents.animo && (out.animo !== null || out.sueno !== null || out.nota)) {
    out.animo = null;
    out.sueno = null;
    out.nota = null;
    quitados.push('animo');
  }
  if (!consents.reaccion && (out.reaccion || out.voz)) {
    out.reaccion = null;
    out.voz = null;
    quitados.push('reaccion');
  }
  const queda = out.escaneo || out.animo !== null || out.sueno !== null || out.reaccion || out.voz;
  if (!queda) return { ok: false, motivo: 'sin_datos_consentidos' };
  return { ok: true, checkin: out, quitados };
}
