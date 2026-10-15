import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { auth } from '../auth.ts';

const diagnosticoSchema = z.object({
  resultado: z.string().regex(/^[A-Z_]{2,40}$/),
  /** Etapa en que terminó: importar el módulo, crear el motor (WASM), validar la licencia o conectar la cámara. */
  etapa: z.enum(['importar', 'crear', 'licencia', 'camara']).optional(),
  ms: z.number().int().min(0).max(600_000),
  /** Tipo y mensaje de la excepción del navegador o del SDK, si la hubo. */
  detalle: z.string().max(200).optional(),
  /** Bytes recibidos del motor WASM del SDK y estado HTTP del módulo, según el navegador. */
  wasmBytes: z.number().int().min(0).max(500_000_000).optional(),
  moduloEstado: z.number().int().min(0).max(999).optional(),
  /** Equipo: memoria aproximada (GB), núcleos y aislamiento de origen (lo exige el SDK). */
  memoriaGb: z.number().min(0).max(1024).optional(),
  nucleos: z.number().int().min(0).max(1024).optional(),
  aislado: z.boolean().optional(),
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
    const log = d.data.resultado === 'OK' || d.data.resultado === 'INICIO' ? console.info : console.warn;
    // Sin saltos de línea ni caracteres de control: una línea por inicialización en los registros.
    const x = d.data;
    const partes = [
      `${x.resultado} en ${(x.ms / 1000).toFixed(1)} s`,
      x.etapa && `etapa ${x.etapa}`,
      x.detalle && x.detalle.replace(/[\x00-\x1F\x7F]/g, ' '),
      x.moduloEstado !== undefined && `módulo HTTP ${x.moduloEstado}`,
      x.wasmBytes !== undefined && `WASM ${(x.wasmBytes / 1e6).toFixed(1)} MB`,
      x.memoriaGb !== undefined && `memoria ${x.memoriaGb} GB`,
      x.nucleos !== undefined && `${x.nucleos} núcleos`,
      x.aislado !== undefined && (x.aislado ? 'aislado' : 'SIN aislamiento de origen'),
      navegador,
    ].filter(Boolean);
    log(`[serena][escaneo] Inicialización del SDK: ${partes.join(' · ')}`);
    res.status(204).end();
  });
  return r;
}
