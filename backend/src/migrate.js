// Simple migration runner: executes every .sql file in ./migrations in order.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  const dir = join(__dirname, 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    process.stdout.write(`Running migration ${file} ... `);
    await pool.query(sql);
    console.log('ok');
  }
  await pool.end();
  console.log('All migrations applied.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
