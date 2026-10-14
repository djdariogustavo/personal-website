import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { auth } from '../auth.ts';

const diagnosticoSchema = z.object({
  resultado: z.string().regex(/^[A-Z_]{2,40}$/),
  ms: z.number().int().min(0).max(600_000),
  /** Tipo y mensaje de la excepción del navegador o del SDK, si la hubo. */
  detalle: z.string().max(200).optional(),
});

/**
 * Diagnóstico de campo del escaneo: cada teléfono informa cómo terminó la inicialización del SDK (código y
 * duración) para ver en los registros del servidor por qué no arranca en un equipo. No lleva datos de la persona
 * ni de la medición: solo el código, el tiempo y el navegador.
 */
export function escaneoRoutes(_ctx: AppContext) {
  const r = Router();
  r.post('/escaneo/diagnostico', (req, res) => {
    auth(req);
    const d = diagnosticoSchema.safeParse(req.body);
    if (!d.success) return res.status(400).json({ error: 'datos_invalidos' });
    const navegador = String(req.headers['user-agent'] ?? '—').slice(0, 200);
    const log = d.data.resultado === 'OK' ? console.info : console.warn;
    // Sin saltos de línea ni caracteres de control: una línea por inicialización en los registros.
    const detalle = d.data.detalle ? ` · ${d.data.detalle.replace(/[\x00-\x1F\x7F]/g, ' ')}` : '';
    log(`[serena][escaneo] Inicialización del SDK: ${d.data.resultado} en ${(d.data.ms / 1000).toFixed(1)} s${detalle} · ${navegador}`);
    res.status(204).end();
  });
  return r;
}
