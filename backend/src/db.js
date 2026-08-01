import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text, params) {
  return pool.query(text, params);
}

// Run fn inside a transaction with a dedicated client.
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Grant or spend credits atomically: writes a ledger row and updates the cached balance.
// Uses the passed transaction client so callers can compose it with other writes.
export async function applyCredits(client, userId, delta, reason, ref = null) {
  await client.query(
    'INSERT INTO credit_ledger (user_id, delta, reason, ref) VALUES ($1,$2,$3,$4)',
    [userId, delta, reason, ref]
  );
  const { rows } = await client.query(
    'UPDATE users SET credits = credits + $2 WHERE id = $1 RETURNING credits',
    [userId, delta]
  );
  return rows[0].credits;
}
