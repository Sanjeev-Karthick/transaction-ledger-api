import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  accountSchema,
  transactionSchema,
  transferSchema,
  historySchema,
  validate,
} from '../../src/ledger/validation.js';

const input = { type: 'credit', amount: '10.50', reference_id: 'ref-1' };

test('account names are required and clients cannot set balance, id or timestamps', () => {
  assert.deepEqual(validate(accountSchema, { name: ' Alice ' }), { name: 'Alice' });
  for (const body of [
    {},
    { name: '  ' },
    { name: 'Alice', balance: 100 },
    { name: 'Alice', id: randomUUID() },
    { name: 'Alice', created_at: '2026-01-01' },
  ]) {
    assert.throws(() => validate(accountSchema, body), { status: 400 });
  }
});

test('amounts allow exact two-decimal numbers or strings and reject invalid precision', () => {
  assert.equal(validate(transactionSchema, input).amount, '10.50');
  assert.equal(validate(transactionSchema, { ...input, amount: 10.5 }).amount, '10.5');
  for (const amount of [0, -1, '0.00', '1.001', '1e2', true, null, '10000000000000000', Infinity]) {
    assert.throws(() => validate(transactionSchema, { ...input, amount }), { status: 400 });
  }
  for (const patch of [{ type: 'invalid' }, { reference_id: ' ' }, { account_id: randomUUID() }]) {
    assert.throws(() => validate(transactionSchema, { ...input, ...patch }), { status: 400 });
  }
});

test('pagination defaults and invalid values', () => {
  assert.deepEqual(validate(historySchema, {}), { page: 1, limit: 20 });
  assert.deepEqual(validate(historySchema, { type: 'debit', page: '2', limit: '5' }), {
    type: 'debit',
    page: 2,
    limit: 5,
  });
  for (const query of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { limit: '101' },
    { limit: '' },
    { type: 'other' },
    { page: ['1', '2'] },
  ]) {
    assert.throws(() => validate(historySchema, query), { status: 400 });
  }
});

test('transfer cannot send money to the same account', () => {
  const id = randomUUID();
  assert.throws(
    () =>
      validate(transferSchema, {
        source_account_id: id,
        destination_account_id: id,
        amount: '1',
        reference_id: 'transfer-1',
      }),
    { status: 400 },
  );
  assert.throws(
    () =>
      validate(transferSchema, {
        source_account_id: id.toUpperCase(),
        destination_account_id: id,
        amount: '1',
        reference_id: 'same-account-different-case',
      }),
    { status: 400 },
  );
});
