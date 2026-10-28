const { randomUUID } = require('node:crypto');
const _ = require('lodash');
const { HttpError } = require('../errors.js');

// All statements inside a transaction use the same connection.
async function inTransaction(pool, work, begin = 'BEGIN') {
  const client = await pool.connect();
  try {
    await client.query(begin);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function requireAccount(client, accountId, lock = false) {
  let sql = 'SELECT * FROM accounts WHERE id = $1';
  if (lock) sql += ' FOR UPDATE';
  const result = await client.query(sql, [accountId]);
  if (!result.rows[0]) {
    throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
  }
  return result.rows[0];
}

async function checkReference(client, accountId, referenceId) {
  const result = await client.query(
    'SELECT id FROM account_transactions WHERE account_id = $1 AND reference_id = $2',
    [accountId, referenceId],
  );
  if (result.rows.length) {
    throw new HttpError(
      409,
      'DUPLICATE_TRANSACTION',
      'Transaction reference already exists for this account',
      {
        account_id: accountId,
        transaction_id: result.rows[0].id,
      },
    );
  }
}

async function insertTransaction(client, accountId, input) {
  const result = await client.query(
    `INSERT INTO account_transactions (id, account_id, type, amount, description, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [randomUUID(), accountId, input.type, input.amount, input.description, input.reference_id],
  );
  return result.rows[0];
}

async function updateBalance(client, accountId, type, amount) {
  // Keep credit/debit SQL explicit. PostgreSQL handles exact decimal arithmetic.
  let sql = 'UPDATE accounts SET balance = balance + $2::numeric WHERE id = $1 RETURNING balance';
  if (type === 'debit') {
    sql = `UPDATE accounts SET balance = balance - $2::numeric
           WHERE id = $1 AND balance >= $2::numeric RETURNING balance`;
  }
  const result = await client.query(sql, [accountId, amount]);
  if (!result.rows.length) {
    throw new HttpError(409, 'INSUFFICIENT_BALANCE', 'Account has insufficient balance');
  }
  return result.rows[0].balance;
}

function createLedgerRepository(pool) {
  return {
    async createAccount(input) {
      const result = await pool.query(
        'INSERT INTO accounts (id, name) VALUES ($1, $2) RETURNING *',
        [randomUUID(), input.name],
      );
      return result.rows[0];
    },

    async getBalance(accountId) {
      const account = await requireAccount(pool, accountId);
      return { account_id: account.id, balance: account.balance };
    },

    async addTransaction(accountId, input) {
      return inTransaction(pool, async (client) => {
        // Serialize writes to this account before checking duplicates or changing its balance.
        await requireAccount(client, accountId, true);
        await checkReference(client, accountId, input.reference_id);
        const balance = await updateBalance(client, accountId, input.type, input.amount);
        const transaction = await insertTransaction(client, accountId, input);
        return { transaction, balance };
      });
    },

    async getHistory(accountId, { type, page, limit }) {
      // The count and page share one snapshot, even when new transactions arrive concurrently.
      return inTransaction(
        pool,
        async (client) => {
          await requireAccount(client, accountId);
          const parameters = [accountId, type ?? null];
          const filter = 'account_id = $1 AND ($2::text IS NULL OR type = $2)';
          const count = await client.query(
            `SELECT count(*)::int AS total FROM account_transactions WHERE ${filter}`,
            parameters,
          );
          const result = await client.query(
            `SELECT * FROM account_transactions WHERE ${filter}
           ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
            [...parameters, limit, (page - 1) * limit],
          );
          const total = count.rows[0].total;
          return {
            data: result.rows,
            pagination: {
              page,
              limit,
              total_records: total,
              total_pages: Math.ceil(total / limit),
            },
          };
        },
        'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
    },

    async transfer(input) {
      return inTransaction(pool, async (client) => {
        // Always lock accounts in the same order to avoid opposite-direction transfer deadlocks.
        const ids = _.sortBy([input.source_account_id, input.destination_account_id]);
        for (const id of ids) {
          await requireAccount(client, id, true);
        }
        for (const id of ids) {
          await checkReference(client, id, input.reference_id);
        }

        const sourceBalance = await updateBalance(
          client,
          input.source_account_id,
          'debit',
          input.amount,
        );
        const destinationBalance = await updateBalance(
          client,
          input.destination_account_id,
          'credit',
          input.amount,
        );
        const debit = await insertTransaction(client, input.source_account_id, {
          ...input,
          type: 'debit',
        });
        const credit = await insertTransaction(client, input.destination_account_id, {
          ...input,
          type: 'credit',
        });
        return {
          debit,
          credit,
          source_balance: sourceBalance,
          destination_balance: destinationBalance,
        };
      });
    },
  };
}

module.exports = { createLedgerRepository };
