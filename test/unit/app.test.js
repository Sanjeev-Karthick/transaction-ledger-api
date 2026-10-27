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
const transaction = {
  id: '8ed9c5b6-2f31-4cd2-a6db-391259a3fa4a',
  reference: 'test-1',
  amountMinor: '1099',
  currency: 'USD',
  direction: 'credit',
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const input = { reference: 'test-1', amountMinor: '1099', currency: 'USD', direction: 'credit' };
function app(options = {}) {
  return createApp({
    config,
    logger: createLogger(config),
    pool: { query: async () => ({ rows: [] }) },
    repository: {
      create: async () => transaction,
      findById: async () => null,
      list: async (pagination) => ({ data: [], pagination: { ...pagination, hasMore: false } }),
    },
    ...options,
  });
}

test('health checks, request ID and security headers', async () => {
  const response = await request(app()).get('/health/live').expect(200);
  assert.equal(response.body.status, 'ok');
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-powered-by'], undefined);
  await request(app()).get('/health/ready').expect(200);
});
test('readiness fails safely when database is unavailable', async () => {
  const response = await request(
    app({
      pool: {
        query: async () => {
          throw new Error('secret');
        },
      },
    }),
  )
    .get('/health/ready')
    .expect(503);
  assert.equal(response.body.status, 'unavailable');
});
test('creates a transaction and returns Location', async () => {
  const response = await request(app()).post('/api/v1/transactions').send(input).expect(201);
  assert.equal(response.body.data.amountMinor, '1099');
  assert.equal(response.headers.location, `/api/v1/transactions/${transaction.id}`);
});
test('rejects numeric, zero and oversized amounts, unknown fields and invalid currencies', async () => {
  for (const patch of [
    { amountMinor: 10 },
    { amountMinor: '0' },
    { amountMinor: '1234567890123456789' },
    { unexpected: true },
    { currency: 'usd' },
  ]) {
    const response = await request(app())
      .post('/api/v1/transactions')
      .send({ ...input, ...patch })
      .expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});
test('validates pagination and UUIDs', async () => {
  await request(app()).get('/api/v1/transactions?limit=101').expect(400);
  await request(app()).get('/api/v1/transactions/not-a-uuid').expect(400);
  await request(app()).get(`/api/v1/transactions/${transaction.id}`).expect(404);
  const response = await request(app()).get('/api/v1/transactions').expect(200);
  assert.deepEqual(response.body.pagination, { limit: 20, offset: 0, hasMore: false });
});
test('returns consistent JSON for invalid JSON, wrong content type and oversized bodies', async () => {
  const response = await request(app())
    .post('/api/v1/transactions')
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
  assert.equal(response.body.error.code, 'INVALID_JSON');
  await request(app()).post('/api/v1/transactions').send('hello').expect(415);
  await request(app())
    .post('/api/v1/transactions')
    .send({ description: 'x'.repeat(33000) })
    .expect(413);
});
test('unexpected failures do not leak database details', async () => {
  const response = await request(
    app({
      repository: {
        list: async () => {
          throw new Error('password=secret');
        },
      },
    }),
  )
    .get('/api/v1/transactions')
    .expect(500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(response.body).includes('secret'));
});
test('duplicate references produce conflict', async () => {
  const repository = {
    create: async () => {
      throw Object.assign(new Error('duplicate'), {
        code: '23505',
        constraint: 'transactions_reference_key',
      });
    },
  };
  await request(app({ repository })).post('/api/v1/transactions').send(input).expect(409);
});
test('rate limiting and CORS allowlist', async () => {
  const instance = app({
    config: { ...config, RATE_LIMIT_MAX: 1, corsOrigins: ['https://example.com'] },
  });
  const allowed = await request(instance)
    .get('/api/v1/transactions')
    .set('Origin', 'https://example.com')
    .expect(200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://example.com');
  const limited = await request(instance).get('/api/v1/transactions').expect(429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  const denied = await request(app()).get('/health/live').set('Origin', 'https://evil.example');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});
test('docs are available when enabled and absent when disabled', async () => {
  await request(app()).get('/openapi.json').expect(200);
  await request(app()).get('/docs/').expect(200);
  await request(app({ config: { ...config, DOCS_ENABLED: false } }))
    .get('/openapi.json')
    .expect(404);
});
test('configuration validates values and defaults docs off in production', () => {
  assert.throws(() => loadConfig({}), /Invalid configuration/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'https://example.com' }), /Invalid configuration/);
  assert.throws(() => loadConfig({ DATABASE_URL: config.DATABASE_URL, DB_SSL: 'yes' }), /DB_SSL/);
  assert.throws(
    () => loadConfig({ DATABASE_URL: config.DATABASE_URL, CORS_ORIGINS: '*' }),
    /CORS_ORIGINS/,
  );
  assert.equal(
    loadConfig({ DATABASE_URL: config.DATABASE_URL, NODE_ENV: 'production' }).DOCS_ENABLED,
    false,
  );
});
