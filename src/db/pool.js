import { readFileSync } from 'node:fs';
import pg from 'pg';

export function createPool(config, logger) {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 10000,
    application_name: 'transaction-ledger-api',
    ssl: config.DB_SSL
      ? {
          rejectUnauthorized: true,
          ...(config.DB_SSL_CA_FILE ? { ca: readFileSync(config.DB_SSL_CA_FILE, 'utf8') } : {}),
        }
      : false,
  });
  pool.on('error', (err) => logger.error({ err }, 'Unexpected idle database connection error'));
  return pool;
}
