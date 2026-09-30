import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from './context.ts';
import { HttpError, authenticate, bajaScope, kioskScope, passwordScope, requireRole } from './auth.ts';
import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { checkinRoutes } from './routes/checkins.ts';
import { companionRoutes } from './routes/companion.ts';
import { safetyRoutes } from './routes/safety.ts';
import { privacyRoutes } from './routes/privacy.ts';
import { passwordRecoveryRoutes, passwordRoutes } from './routes/password.ts';
import { adminRoutes } from './routes/admin.ts';
import { webhookRoutes } from './routes/webhooks.ts';

/**
 * - aislamientoOrigen: envía COOP/COEP (aislamiento de origen). Lo exige el SDK de escaneo, que usa SharedArrayBuffer.
 * - escaneoConnectSrc: orígenes a los que el SDK de escaneo se conecta (licencia); los informa el proveedor.
 */
export interface OpcionesApp {
  staticDir?: string;
  aislamientoOrigen?: boolean;
  escaneoConnectSrc?: string[];
}

export function createApp(ctx: AppContext, opts: OpcionesApp = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          // 'wasm-unsafe-eval' permite compilar WebAssembly (el SDK de escaneo), no eval() de JavaScript.
          scriptSrc: opts.aislamientoOrigen ? ["'self'", "'wasm-unsafe-eval'"] : ["'self'"],
          connectSrc: ["'self'", ...(opts.escaneoConnectSrc ?? [])],
          workerSrc: opts.aislamientoOrigen ? ["'self'", 'blob:'] : ["'self'"],
        },
      },
      // COOP/COEP solo con el SDK de escaneo: sin él no hacen falta y restringen recursos de otros orígenes.
      crossOriginEmbedderPolicy: opts.aislamientoOrigen ? { policy: 'require-corp' } : false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), ambient-light-sensor=(self)');
    next();
  });

  // Webhooks antes del parser JSON (necesitan el cuerpo crudo).
  app.use('/api', webhookRoutes(ctx));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json(ctx.config));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/auth', passwordRecoveryRoutes(ctx));

  const authed = express.Router();
  authed.use(authenticate(ctx));
  authed.use(kioskScope());
  authed.use(bajaScope());
  authed.use(passwordScope());
  authed.use(meRoutes(ctx));
  authed.use(checkinRoutes(ctx));
  authed.use(companionRoutes(ctx));
  authed.use(safetyRoutes(ctx));
  authed.use(privacyRoutes(ctx));
  authed.use('/admin', requireRole('admin'));
  authed.use(adminRoutes(ctx));
  authed.use(passwordRoutes(ctx));
  app.use('/api', authed);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'no_encontrado')));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(opts.staticDir!, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, mensaje: err.message });
    if (err instanceof ZodError) return res.status(400).json({ error: 'datos_invalidos', detalle: err.issues.map((i) => i.path.join('.')) });
    if ((err as { type?: string })?.type === 'entity.parse.failed') return res.status(400).json({ error: 'json_invalido' });
    console.error('[serena] error no controlado', err);
    res.status(500).json({ error: 'error_interno', mensaje: 'Algo salió mal. Probá de nuevo en un momento.' });
  });

  return app;
}
