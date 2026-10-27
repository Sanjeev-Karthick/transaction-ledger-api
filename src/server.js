import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config, logger);
let server;
let shuttingDown = false;

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'Shutting down');
  const timeout = setTimeout(() => {
    logger.error('Graceful shutdown deadline exceeded');
    process.exit(1);
  }, 15000);
  timeout.unref();
  try {
    if (server)
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    await pool.end();
    process.exitCode = exitCode;
  } catch (err) {
    logger.error({ err }, 'Shutdown failed');
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});

try {
  await pool.query('SELECT id FROM transactions LIMIT 0');
  const app = createApp({ config, pool, logger });
  server = app.listen(config.PORT, config.HOST, () => {
    logger.info({ port: config.PORT, environment: config.NODE_ENV }, 'API listening');
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server error');
    void shutdown('server error', 1);
  });
} catch (err) {
  logger.fatal({ err }, 'Startup failed; verify database connectivity and run migrations');
  await shutdown('startup failure', 1);
}
