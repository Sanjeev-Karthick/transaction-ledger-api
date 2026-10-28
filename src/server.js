const { loadConfig } = require('./config.js');
const { createLogger } = require('./logger.js');
const { createPool } = require('./db/pool.js');
const { createApp } = require('./app.js');

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
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
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

try {
  const app = createApp({ config, pool, logger });
  server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info(`API listening on http://localhost:${config.PORT}`);
  });
  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server error');
    void shutdown('server error', 1);
  });
} catch (err) {
  logger.fatal({ err }, 'API startup failed');
  shutdown('startup failure', 1);
}
