import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { createApp } from '../../src/app.js';

test('PostgreSQL migrations, persistence, constraints, pagination and append-only behavior', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(databaseUrl, 'TEST_DATABASE_URL is required and must point to a disposable database');
  assert.match(new URL(databaseUrl).pathname, /_test$/, 'Test database name must end in _test');
  if (process.env.DATABASE_URL) {
    assert.notEqual(
      new URL(databaseUrl).pathname,
      new URL(process.env.DATABASE_URL).pathname,
      'Test database must differ from application database',
    );
  }
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: 'silent',
  });
  const logger = createLogger(config);
  const pool = createPool(config, logger);
  try {
    await migrate(pool, logger);
    await migrate(pool, logger); // Re-running applied migrations must be safe.
    const app = createApp({ config, pool, logger });
    const input = {
      reference: `integration-${randomUUID()}`,
      amountMinor: '999999999999999999',
      currency: 'USD',
      direction: 'credit',
    };
    const created = await request(app).post('/api/v1/transactions').send(input).expect(201);
    assert.equal(created.body.data.amountMinor, input.amountMinor);
    const id = created.body.data.id;
    const fetched = await request(app).get(`/api/v1/transactions/${id}`).expect(200);
    assert.deepEqual(fetched.body.data, created.body.data);
    await request(app).post('/api/v1/transactions').send(input).expect(409);
    await request(app)
      .post('/api/v1/transactions')
      .send({ ...input, reference: `${input.reference}-2` })
      .expect(201);
    const list = await request(app).get('/api/v1/transactions?limit=1').expect(200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.pagination.hasMore, true);
    await assert.rejects(
      pool.query('UPDATE transactions SET description = $1 WHERE id = $2', ['changed', id]),
      { code: '23514' },
    );
    await assert.rejects(pool.query('DELETE FROM transactions WHERE id = $1', [id]), {
      code: '23514',
    });
    await assert.rejects(pool.query('TRUNCATE transactions'), { code: '23514' });
    await assert.rejects(
      pool.query(
        `INSERT INTO transactions (id, reference, amount_minor, currency, direction)
      VALUES ($1, $2, 0, 'USD', 'credit')`,
        [randomUUID(), randomUUID()],
      ),
      { code: '23514' },
    );
    await request(app).get('/health/ready').expect(200);
  } finally {
    await pool.end();
  }
});
