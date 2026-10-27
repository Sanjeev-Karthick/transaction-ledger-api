import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { createApp } from '../../src/app.js';

test('ledger correctness, concurrency, rollback and transfers with PostgreSQL', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'TEST_DATABASE_URL is required');
  assert.match(new URL(url).pathname, /_test$/);
  if (process.env.DATABASE_URL) {
    assert.notEqual(
      new URL(url).pathname,
      new URL(process.env.DATABASE_URL).pathname,
      'Integration tests must not use the application database',
    );
  }
  const config = loadConfig({ ...process.env, DATABASE_URL: url, LOG_LEVEL: 'silent' });
  const logger = createLogger(config);
  const pool = createPool(config, logger);
  const app = createApp({ config, pool, logger });
  const base = '/api/v1/accounts';
  const createAccount = async (name) =>
    (await request(app).post(base).send({ name }).expect(201)).body.data;
  const balance = async (id) =>
    (await request(app).get(`${base}/${id}/balance`).expect(200)).body.data.balance;
  const add = (id, type, amount, reference_id = randomUUID()) =>
    request(app).post(`${base}/${id}/transactions`).send({ type, amount, reference_id });
  const history = async (id, query = '') =>
    (await request(app).get(`${base}/${id}/transactions${query}`).expect(200)).body;
  const transfer = (source, destination, amount, reference_id = randomUUID()) =>
    request(app).post('/api/v1/transfers').send({
      source_account_id: source,
      destination_account_id: destination,
      amount,
      reference_id,
    });

  try {
    await migrate(pool);
    await migrate(pool);

    await t.test('accounts start at zero; credits and debits sum exactly', async () => {
      const account = await createAccount('Alice');
      assert.equal(account.balance, '0.00');
      assert.ok(account.created_at);
      await add(account.id, 'credit', '100').expect(201);
      await add(account.id, 'credit', '50').expect(201);
      await add(account.id, 'debit', '30').expect(201);
      await add(account.id, 'debit', '20').expect(201);
      assert.equal(await balance(account.id), '100.00');
      await add(account.id, 'debit', '100.01').expect(409);
      assert.equal(await balance(account.id), '100.00');
      assert.equal((await history(account.id)).pagination.total_records, 4);
      await add(account.id, 'credit', '0.10').expect(201);
      await add(account.id, 'credit', '0.20').expect(201);
      assert.equal(await balance(account.id), '100.30');
    });

    await t.test(
      'duplicates are scoped to account and concurrent submissions apply once',
      async () => {
        const a = await createAccount('Duplicate A');
        const b = await createAccount('Duplicate B');
        const reference = randomUUID();
        const results = await Promise.all([
          add(a.id, 'credit', '10', reference),
          add(a.id, 'credit', '10', reference),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        assert.equal(await balance(a.id), '10.00');
        await add(a.id, 'credit', '99', reference).expect(409);
        await add(b.id, 'credit', '10', reference).expect(201);
        assert.equal((await history(a.id)).pagination.total_records, 1);
      },
    );

    await t.test('concurrent debits cannot overdraw', async () => {
      const account = await createAccount('Concurrent');
      await add(account.id, 'credit', '100').expect(201);
      const results = await Promise.all([
        add(account.id, 'debit', '80'),
        add(account.id, 'debit', '80'),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await balance(account.id), '20.00');
    });

    await t.test('history filters, pagination and latest-first order', async () => {
      const account = await createAccount('History');
      for (const [type, amount] of [
        ['credit', '30'],
        ['debit', '5'],
        ['credit', '10'],
      ]) {
        await add(account.id, type, amount).expect(201);
      }
      const first = await history(account.id, '?page=1&limit=2');
      const second = await history(account.id, '?page=2&limit=2');
      assert.deepEqual(first.pagination, { page: 1, limit: 2, total_records: 3, total_pages: 2 });
      assert.equal(first.data[0].amount, '10.00');
      assert.equal(second.data.length, 1);
      assert.equal((await history(account.id, '?type=debit')).pagination.total_records, 1);
      assert.equal((await history(account.id, '?page=99')).data.length, 0);
      for (const query of ['?page=0', '?limit=101', '?type=other']) {
        await request(app).get(`${base}/${account.id}/transactions${query}`).expect(400);
      }
    });

    await t.test('missing accounts, invalid IDs and invalid bodies', async () => {
      await request(app).post(base).send({ name: 'No', balance: 100 }).expect(400);
      await request(app).post(base).send({}).expect(400);
      await request(app).get(`${base}/invalid/balance`).expect(400);
      await request(app).get(`${base}/${randomUUID()}/balance`).expect(404);
      await request(app).get(`${base}/${randomUUID()}/transactions`).expect(404);
      await add(randomUUID(), 'credit', '1').expect(404);
      const account = await createAccount('Validation');
      await add(account.id, 'invalid', '1').expect(400);
      await add(account.id, 'credit', '0').expect(400);
      await request(app)
        .post(`${base}/${account.id}/transactions`)
        .send({ type: 'credit', amount: 1 })
        .expect(400);
    });

    await t.test('transactions are immutable in API and database', async () => {
      const account = await createAccount('Immutable');
      const response = await add(account.id, 'credit', '10').expect(201);
      const id = response.body.data.transaction.id;
      await request(app)
        .patch(`${base}/${account.id}/transactions/${id}`)
        .send({ amount: 2 })
        .expect(404);
      await request(app).delete(`${base}/${account.id}/transactions/${id}`).expect(404);
      await assert.rejects(
        pool.query('UPDATE account_transactions SET amount = 1 WHERE id = $1', [id]),
        { code: '23514' },
      );
      await assert.rejects(pool.query('DELETE FROM account_transactions WHERE id = $1', [id]), {
        code: '23514',
      });
    });

    await t.test(
      'transfer success, duplicate, insufficient funds and missing destination',
      async () => {
        const a = await createAccount('Transfer A');
        const b = await createAccount('Transfer B');
        await add(a.id, 'credit', '100').expect(201);
        await add(b.id, 'credit', '50').expect(201);
        const ref = randomUUID();
        await transfer(a.id, b.id, '30', ref).expect(201);
        assert.equal(await balance(a.id), '70.00');
        assert.equal(await balance(b.id), '80.00');
        await transfer(a.id, b.id, '30', ref).expect(409);
        await transfer(a.id, b.id, '1000').expect(409);
        await transfer(a.id, randomUUID(), '1').expect(404);
        assert.equal(await balance(a.id), '70.00');
        assert.equal(await balance(b.id), '80.00');
        const opposite = await Promise.all([transfer(a.id, b.id, '1'), transfer(b.id, a.id, '1')]);
        assert.deepEqual(
          opposite.map((r) => r.status),
          [201, 201],
        );
        assert.equal(await balance(a.id), '70.00');
        assert.equal(await balance(b.id), '80.00');
      },
    );

    await t.test('injected insert failure rolls back balance and both transfer legs', async () => {
      const a = await createAccount('Rollback A');
      const b = await createAccount('Rollback B');
      await add(a.id, 'credit', '100').expect(201);
      // Fail the first normal insert, or the second insert of a transfer, without changing the database schema.
      function failingPool(failAt) {
        return {
          query: pool.query.bind(pool),
          connect: async () => {
            const client = await pool.connect();
            let inserts = 0;
            return {
              query: async (sql, params) => {
                if (sql.includes('INSERT INTO account_transactions') && ++inserts === failAt)
                  throw new Error('Injected insert failure');
                return client.query(sql, params);
              },
              release: () => client.release(),
            };
          },
        };
      }
      const brokenApp = createApp({ config, logger, pool: failingPool(1) });
      await request(brokenApp)
        .post(`${base}/${a.id}/transactions`)
        .send({ type: 'credit', amount: 10, reference_id: randomUUID() })
        .expect(500);
      const brokenTransferApp = createApp({ config, logger, pool: failingPool(2) });
      await request(brokenTransferApp)
        .post('/api/v1/transfers')
        .send({
          source_account_id: a.id,
          destination_account_id: b.id,
          amount: 10,
          reference_id: randomUUID(),
        })
        .expect(500);
      assert.equal(await balance(a.id), '100.00');
      assert.equal(await balance(b.id), '0.00');
      assert.equal((await history(a.id)).pagination.total_records, 1);
      assert.equal((await history(b.id)).pagination.total_records, 0);
    });

    const consistency = await pool.query(`SELECT a.id FROM accounts a
      LEFT JOIN account_transactions t ON t.account_id = a.id
      GROUP BY a.id HAVING a.balance <> COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0)`);
    assert.equal(consistency.rows.length, 0, 'Every balance must equal its transaction sum');
  } finally {
    await pool.end();
  }
});
