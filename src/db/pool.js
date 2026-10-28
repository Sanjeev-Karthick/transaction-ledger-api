const { readFileSync } = require('node:fs');
const pg = require('pg');

function createPool(config, logger) {
  let ssl = false;
  if (config.DB_SSL) {
    ssl = { rejectUnauthorized: true };
    if (config.DB_SSL_CA_FILE) {
      ssl.ca = readFileSync(config.DB_SSL_CA_FILE, 'utf8');
    }
  }

  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    ssl,
  });
  pool.on('error', (err) => logger.error({ err }, 'Unexpected idle database connection error'));
  return pool;
}

module.exports = { createPool };
