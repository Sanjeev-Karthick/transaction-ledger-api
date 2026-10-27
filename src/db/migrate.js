import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export async function migrate(pool, logger) {
  const client = await pool.connect();
  let locked = false;
  try {
    // Session lock serializes concurrent deploy jobs. One client owns every transaction and the lock.
    await client.query("SET lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_lock(781245901)');
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = new URL('../../migrations/', import.meta.url);
    const files = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const { rows } = await client.query(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [name],
      );
      if (rows.length) {
        if (rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          name,
          checksum,
        ]);
        await client.query('COMMIT');
        logger.info({ migration: name }, 'Migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(781245901)');
    } finally {
      client.release();
    }
  }
}
