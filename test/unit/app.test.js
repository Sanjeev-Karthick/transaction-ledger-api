const { describe, it, afterEach } = require('mocha');
const sinon = require('sinon');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../../src/app.js');
const { loadConfig } = require('../../src/config.js');
const { createLogger } = require('../../src/logger.js');
const { HttpError } = require('../../src/errors.js');

const config = loadConfig({
  DATABASE_URL: 'postgres://test:test@localhost/test',
  LOG_LEVEL: 'silent',
});

function createTestApp(options = {}) {
  return createApp({
    config,
    logger: createLogger(config),
    pool: { query: sinon.stub().resolves({ rows: [] }) },
    ...options,
  });
}

describe('API', function () {
  afterEach(() => sinon.restore());

  it('passes a validated account name to the repository', async () => {
    const account = { id: 'account-1', name: 'Alice', balance: '0.00' };
    const repository = { createAccount: sinon.stub().resolves(account) };
    const response = await request(createTestApp({ repository }))
      .post('/api/v1/accounts')
      .send({ name: ' Alice ' })
      .expect(201);
    assert.deepEqual(response.body.data, account);
    sinon.assert.calledOnceWithExactly(repository.createAccount, { name: 'Alice' });
  });

  it('rejects a client-supplied balance before calling the repository', async () => {
    const repository = { createAccount: sinon.stub() };
    await request(createTestApp({ repository }))
      .post('/api/v1/accounts')
      .send({ name: 'Alice', balance: 100 })
      .expect(400);
    sinon.assert.notCalled(repository.createAccount);
  });

  it('returns a repository conflict as a consistent API error', async () => {
    const repository = {
      addTransaction: sinon
        .stub()
        .rejects(new HttpError(409, 'INSUFFICIENT_BALANCE', 'Account has insufficient balance')),
    };
    const id = 'ecb4dc3b-c6e0-46bd-baa3-b9be5cb68562';
    const response = await request(createTestApp({ repository }))
      .post(`/api/v1/accounts/${id}/transactions`)
      .send({ type: 'debit', amount: '10.00', reference_id: 'payment-1' })
      .expect(409);
    assert.equal(response.body.error.code, 'INSUFFICIENT_BALANCE');
    sinon.assert.calledOnceWithExactly(repository.addTransaction, id, {
      type: 'debit',
      amount: '10.00',
      reference_id: 'payment-1',
      description: '',
    });
  });

  it('health check uses SELECT 1 without requiring tables', async () => {
    const pool = { query: sinon.stub().resolves({ rows: [] }) };
    const response = await request(createTestApp({ pool })).get('/health').expect(200);
    assert.deepEqual(response.body, { status: 'ok', database: 'connected' });
    sinon.assert.calledOnceWithExactly(pool.query, 'SELECT 1');
  });

  it('health returns 503 without exposing database errors', async () => {
    const pool = { query: sinon.stub().rejects(new Error('private database details')) };
    const app = createTestApp({ pool });
    const response = await request(app).get('/health').expect(503);
    assert.deepEqual(response.body, { status: 'unavailable', database: 'disconnected' });
    // The starter endpoint still works while the database is down.
    await request(app).get('/api/v1/starter').expect(200);
    sinon.assert.calledOnce(pool.query);
  });

  it('starter returns a simple response and security headers', async () => {
    const response = await request(createTestApp()).get('/api/v1/starter').expect(200);
    assert.deepEqual(response.body, { message: 'API is ready' });
    assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-powered-by'], undefined);
  });

  it('unknown routes return consistent errors', async () => {
    for (const path of ['/api/v1/transactions', '/health/live', '/health/ready', '/missing']) {
      const response = await request(createTestApp()).get(path).expect(404);
      assert.equal(response.body.error.code, 'NOT_FOUND');
    }
  });

  it('malformed JSON returns a readable error', async () => {
    const response = await request(createTestApp())
      .post('/api/v1/starter')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    assert.equal(response.body.error.code, 'INVALID_JSON');
  });

  it('docs describe the health, starter and ledger APIs', async () => {
    const response = await request(createTestApp()).get('/openapi.json').expect(200);
    assert.ok(response.body.paths['/health']);
    assert.ok(response.body.paths['/api/v1/accounts']);
    await request(createTestApp()).get('/docs/').expect(200);
    const app = createTestApp({ config: { ...config, DOCS_ENABLED: false } });
    await request(app).get('/openapi.json').expect(404);
  });

  it('CORS only allows configured origins', async () => {
    const app = createTestApp({ config: { ...config, corsOrigins: ['https://example.com'] } });
    const allowed = await request(app).get('/api/v1/starter').set('Origin', 'https://example.com');
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://example.com');
    const denied = await request(app).get('/api/v1/starter').set('Origin', 'https://other.example');
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });

  it('configuration validates required values and boolean defaults', () => {
    assert.throws(() => loadConfig({}), /Invalid configuration/);
    assert.throws(() => loadConfig({ DATABASE_URL: 'not-a-url' }), /Invalid configuration/);
    assert.equal(config.DB_SSL, false);
    assert.equal(loadConfig({ DATABASE_URL: config.DATABASE_URL, DB_SSL: 'true' }).DB_SSL, true);
    assert.equal(
      loadConfig({ DATABASE_URL: config.DATABASE_URL, NODE_ENV: 'production' }).DOCS_ENABLED,
      false,
    );
  });
});
