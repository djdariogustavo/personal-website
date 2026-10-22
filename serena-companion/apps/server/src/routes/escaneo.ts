import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { auth, HttpError } from '../auth.ts';
import { rateLimit } from '../ratelimit.ts';
import { getConsents } from '../users.ts';
import { ErrorTokenEscaneo } from '../escaneoToken.ts';

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
export function escaneoRoutes(ctx: AppContext) {
  const r = Router();

  /**
   * Token de corta duración para inicializar el SDK (ver escaneoToken.ts): la credencial del proveedor no viaja en la
   * app. Solo con el consentimiento de cámara vigente, y con un límite por persona para que una cuenta no pueda
   * agotar las mediciones de la licencia.
   */
  const limiteToken = rateLimit({ windowMs: 60 * 60_000, max: 20, key: (req) => `scan-token:${req.auth?.userId ?? req.ip}` });
  r.post('/escaneo/token', limiteToken, async (req, res) => {
    const a = auth(req);
    if (!ctx.escaneoTokens) throw new HttpError(404, 'escaneo_sin_tokens', 'El escaneo no tiene licencia configurada en el servidor.');
    if (!getConsents(ctx.db, a.userId).camara) throw new HttpError(403, 'sin_consentimiento', 'Activá la cámara en Privacidad para usar el escaneo.');
    try {
      const t = await ctx.escaneoTokens.emitir();
      res.set('cache-control', 'no-store').json(t);
    } catch (e) {
      if (e instanceof ErrorTokenEscaneo && e.estado === 0) throw new HttpError(503, 'escaneo_sin_conexion', 'No se pudo contactar al servicio de escaneo.');
      throw new HttpError(502, 'escaneo_sin_licencia', 'El servicio de escaneo no está habilitado en este momento.');
    }
  });

  r.post('/escaneo/diagnostico', (req, res) => {
    auth(req);
    const d = diagnosticoSchema.safeParse(req.body);
    if (!d.success) {
      // También se registra: un diagnóstico que no llega es justo lo que hay que poder ver.
      const campos = d.error.issues.map((i) => i.path.join('.') || '(cuerpo)').join(', ');
      console.warn(`[serena][escaneo] Diagnóstico con datos inválidos (${campos}): ${JSON.stringify(req.body ?? null).slice(0, 300)}`);
      return res.status(400).json({ error: 'datos_invalidos' });
    }
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
