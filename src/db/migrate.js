const { createHash } = require('node:crypto');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

async function migrate(pool) {
  const client = await pool.connect();
  try {
    // One atomic migration batch; concurrent startup processes cannot race.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(781245901)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = path.join(__dirname, '../../migrations');
    const files = (await readdir(directory)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await readFile(path.join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [name],
      );
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration changed: ${name}`);
        }
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        name,
        checksum,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { migrate };
