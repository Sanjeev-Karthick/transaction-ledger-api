const { describe, it } = require('mocha');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadConfig } = require('../../src/config.js');
const { createLogger } = require('../../src/logger.js');
const { createPool } = require('../../src/db/pool.js');
const { createApp } = require('../../src/app.js');

describe('PostgreSQL health', function () {
  it('health check connects to real PostgreSQL without creating tables', async () => {
    assert.ok(
      process.env.TEST_DATABASE_URL,
      'Set TEST_DATABASE_URL to an integration test database',
    );
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOG_LEVEL: 'silent',
    });
    const logger = createLogger(config);
    const pool = createPool(config, logger);
    try {
      const app = createApp({ config, pool, logger });
      const response = await request(app).get('/health').expect(200);
      assert.deepEqual(response.body, { status: 'ok', database: 'connected' });
      await request(app).get('/api/v1/starter').expect(200);
    } finally {
      await pool.end();
    }
  });
});
