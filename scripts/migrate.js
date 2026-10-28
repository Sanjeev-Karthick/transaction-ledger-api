const { loadConfig } = require('../src/config.js');
const { createLogger } = require('../src/logger.js');
const { createPool } = require('../src/db/pool.js');
const { migrate } = require('../src/db/migrate.js');

async function main() {
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
