import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

const config = loadConfig({
  DATABASE_URL: 'postgres://test:test@localhost/test',
  LOG_LEVEL: 'silent',
});

function createTestApp(options = {}) {
  return createApp({
    config,
    logger: createLogger(config),
    pool: { query: async () => ({ rows: [] }) },
    ...options,
  });
}

test('health check uses SELECT 1 without requiring tables', async () => {
  const pool = {
    query: async (sql) => {
      assert.equal(sql, 'SELECT 1');
    },
  };
  const response = await request(createTestApp({ pool })).get('/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok', database: 'connected' });
});

test('health returns 503 without exposing database errors', async () => {
  const pool = {
    query: async () => {
      throw new Error('private database details');
    },
  };
  const app = createTestApp({ pool });
  const response = await request(app).get('/health').expect(503);
  assert.deepEqual(response.body, { status: 'unavailable', database: 'disconnected' });
  // The starter endpoint still works while the database is down.
  await request(app).get('/api/v1/starter').expect(200);
});

test('starter returns a simple response and security headers', async () => {
  const response = await request(createTestApp()).get('/api/v1/starter').expect(200);
  assert.deepEqual(response.body, { message: 'API is ready' });
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('unknown routes return consistent errors', async () => {
  for (const path of ['/api/v1/transactions', '/health/live', '/health/ready', '/missing']) {
    const response = await request(createTestApp()).get(path).expect(404);
    assert.equal(response.body.error.code, 'NOT_FOUND');
  }
});

test('malformed JSON returns a readable error', async () => {
  const response = await request(createTestApp())
    .post('/api/v1/starter')
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
  assert.equal(response.body.error.code, 'INVALID_JSON');
});

test('docs describe the health, starter and ledger APIs', async () => {
  const response = await request(createTestApp()).get('/openapi.json').expect(200);
  assert.ok(response.body.paths['/health']);
  assert.ok(response.body.paths['/api/v1/accounts']);
  await request(createTestApp()).get('/docs/').expect(200);
  const app = createTestApp({ config: { ...config, DOCS_ENABLED: false } });
  await request(app).get('/openapi.json').expect(404);
});

test('CORS only allows configured origins', async () => {
  const app = createTestApp({ config: { ...config, corsOrigins: ['https://example.com'] } });
  const allowed = await request(app).get('/api/v1/starter').set('Origin', 'https://example.com');
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://example.com');
  const denied = await request(app).get('/api/v1/starter').set('Origin', 'https://other.example');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('configuration validates required values and boolean defaults', () => {
  assert.throws(() => loadConfig({}), /Invalid configuration/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'not-a-url' }), /Invalid configuration/);
  assert.equal(config.DB_SSL, false);
  assert.equal(loadConfig({ DATABASE_URL: config.DATABASE_URL, DB_SSL: 'true' }).DB_SSL, true);
  assert.equal(
    loadConfig({ DATABASE_URL: config.DATABASE_URL, NODE_ENV: 'production' }).DOCS_ENABLED,
    false,
  );
});
