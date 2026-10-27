import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { HttpError, errorHandler } from './errors.js';

const openapi = JSON.parse(readFileSync(new URL('../docs/openapi.json', import.meta.url), 'utf8'));

export function createApp({ config, pool, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Do not log query strings or arbitrary request headers/body (potential secrets/PII).
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/health', async function healthCheck(req, res) {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      req.log.error({ err: error }, 'Database health check failed');
      res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 100,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests')),
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/v1/starter', function starter(_req, res) {
    res.json({ message: 'API is ready' });
  });
  if (config.DOCS_ENABLED) {
    app.get('/openapi.json', (_req, res) => res.json(openapi));
    // Scoped Swagger CSP override; API responses retain the full Helmet defaults.
    app.use(
      '/docs',
      helmet.contentSecurityPolicy({
        useDefaults: true,
        directives: {
          'script-src': ["'self'", "'unsafe-inline'"],
          'upgrade-insecure-requests': null,
        },
      }),
      swaggerUi.serve,
      swaggerUi.setup(openapi, { swaggerOptions: { validatorUrl: null } }),
    );
  }
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler);
  return app;
}
