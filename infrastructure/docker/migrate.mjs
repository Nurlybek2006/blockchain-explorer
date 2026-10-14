import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const allowed = new Set(['IDENTITY_DATABASE_URL', 'EXPLORER_DATABASE_URL', 'PORTFOLIO_DATABASE_URL']);
const variable = process.env.MIGRATION_DATABASE_ENV;
if (!allowed.has(variable) || !process.env[variable]) throw new Error('Migration database configuration is missing');

// One migration process per owned database; replicas never race the journal.
const pool = new Pool({ connectionString: process.env[variable], max: 1, connectionTimeoutMillis: 5_000 });
let client;
try {
  client = await pool.connect();
  await client.query("SET statement_timeout = '120s'");
  await client.query('SELECT pg_advisory_lock(81948212)');
  await migrate(drizzle(client), { migrationsFolder: '/app/migrations' });
  console.log('Owned database migrations applied');
} catch {
  console.error('Database migration failed; applications will not start. Inspect the database and migration history.');
  process.exitCode = 1;
} finally {
  if (client) {
    await client.query('SELECT pg_advisory_unlock(81948212)').catch(() => undefined);
    client.release();
  }
  await pool.end();
}
