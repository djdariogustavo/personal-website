import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './auth.ts';

/**
 * Límite de pedidos en memoria (ventana fija), por IP o por la clave que se indique.
 * En los campamentos muchos trabajadores comparten IP (Starlink/NAT), por eso
 * el login se limita por IP + identificador y no solo por IP. Suficiente para una
 * instancia; con varias instancias se reemplaza por un almacén compartido.
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = opts.key ? opts.key(req) : (req.ip ?? 'desconocida');
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + opts.windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return next();
    }
    h.n++;
    if (h.n > opts.max) return next(new HttpError(429, 'demasiados_intentos', 'Demasiados intentos. Probá en unos minutos.'));
    next();
  };
}
