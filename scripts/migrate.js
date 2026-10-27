import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config, logger);
try {
  await migrate(pool);
  logger.info('Database migrations complete');
} catch (error) {
  logger.error({ err: error }, 'Migration failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
