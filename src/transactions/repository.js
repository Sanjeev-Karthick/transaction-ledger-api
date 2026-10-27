import { randomUUID } from 'node:crypto';

const columns = `id, reference, amount_minor::text AS "amountMinor", currency,
  direction, description, created_at AS "createdAt"`;

export function createTransactionRepository(pool) {
  return {
    async create(input) {
      const { rows } = await pool.query(
        `INSERT INTO transactions (id, reference, amount_minor, currency, direction, description)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${columns}`,
        [
          randomUUID(),
          input.reference,
          input.amountMinor,
          input.currency,
          input.direction,
          input.description,
        ],
      );
      return rows[0];
    },
    async findById(id) {
      const { rows } = await pool.query(`SELECT ${columns} FROM transactions WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },
    async list({ limit, offset }) {
      const { rows } = await pool.query(
        `SELECT ${columns} FROM transactions ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
        [limit + 1, offset],
      );
      return {
        data: rows.slice(0, limit),
        pagination: { limit, offset, hasMore: rows.length > limit },
      };
    },
  };
}
