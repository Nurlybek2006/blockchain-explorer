import { afterAll, describe, expect, inject, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { createDatabase, databases, migrateDatabase, root, type DatabaseOwner } from '../helpers/test-environment.js';
import { array, record, string } from '../helpers/assertions.js';

const temporaryFolders: string[] = [];
afterAll(async () => { for (const folder of temporaryFolders) await rm(folder, { force: true, recursive: true }); });

describe('actual Drizzle migrations and database ownership', () => {
  for (const owner of Object.keys(databases) as DatabaseOwner[]) {
    it(`${owner}: fresh migration owns only its service tables and is idempotent`, async () => {
      const environment = inject('environment');
      const pool = new Pool({ connectionString: environment.databaseUrls[owner] });
      try {
        const result = await drizzle(pool).execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
        const names = result.rows.map((row) => string(record(row).tablename));
        const owned = { identity: 'users', explorer: 'blocks', portfolio: 'portfolios' };
        expect(names).toContain(owned[owner]);
        for (const other of Object.keys(databases) as DatabaseOwner[]) if (other !== owner) expect(names).not.toContain(owned[other]);
        const before = await pool.query<{ count: string }>('SELECT count(*) FROM drizzle.__drizzle_migrations');
        await migrateDatabase(owner, environment.databaseUrls[owner]);
        const after = await pool.query<{ count: string }>('SELECT count(*) FROM drizzle.__drizzle_migrations');
        expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
      } finally { await pool.end(); }
    });

    it(`${owner}: upgrade preserves an existing migrated database and its rows`, async () => {
      const environment = inject('environment');
      const url = await createDatabase(environment.adminUrl, `tc_upgrade_${owner}_${environment.runId}`);
      const source = resolve(root, 'apps', databases[owner], 'src/database/migrations');
      const journal = record(JSON.parse(await readFile(resolve(source, 'meta/_journal.json'), 'utf8')));
      const entries = array(journal.entries);
      const first = record(entries[0]);
      const folder = await mkdtemp(resolve(tmpdir(), 'explorer-migrations-'));
      temporaryFolders.push(folder);
      await mkdir(resolve(folder, 'meta'));
      await writeFile(resolve(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: [first] }));
      const tag = string(first.tag);
      if (!/^\d{4}_[a-z0-9_]+$/.test(tag)) throw new Error('Invalid checked-in migration tag');
      await writeFile(resolve(folder, `${tag}.sql`), await readFile(resolve(source, `${tag}.sql`)));
      await migrateDatabase(owner, url, folder);
      const pool = new Pool({ connectionString: url });
      try {
        if (owner === 'identity') await pool.query("INSERT INTO users (email,password_hash) VALUES ('legacy@example.test','legacy-password-hash')");
        if (owner === 'explorer') await pool.query("INSERT INTO blocks (number,hash,parent_hash,timestamp,gas_limit,gas_used) VALUES (100,$1,$2,'2026-01-01',1000000,21000)", [`0x${'9'.repeat(64)}`, `0x${'0'.repeat(64)}`]);
        if (owner === 'portfolio') await pool.query("INSERT INTO portfolios (user_id,name,wallet_address) VALUES ('00000000-0000-4000-8000-000000000001','Legacy Portfolio',$1)", [`0x${'1'.repeat(40)}`]);
        await migrateDatabase(owner, url);
        if (owner === 'identity') expect((await pool.query<{ password_hash: string; is_active: boolean }>("SELECT password_hash,is_active FROM users WHERE email='legacy@example.test'")).rows[0]).toEqual({ password_hash: 'legacy-password-hash', is_active: true });
        if (owner === 'explorer') expect((await pool.query<{ number: string; gas_used: string }>('SELECT number,gas_used FROM blocks WHERE number=100')).rows[0]).toEqual({ number: '100', gas_used: '21000' });
        if (owner === 'portfolio') expect((await pool.query<{ name: string; chain_id: number }>("SELECT name,chain_id FROM portfolios WHERE name='Legacy Portfolio'")).rows[0]).toEqual({ name: 'Legacy Portfolio', chain_id: 1 });
        expect(Number((await pool.query<{ count: string }>('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0]?.count)).toBe(entries.length);
        const expected = { identity: 'refresh_tokens', explorer: 'transaction_trace_requests', portfolio: 'alert_events' };
        expect((await pool.query<{ table_name: string }>('SELECT table_name FROM information_schema.tables WHERE table_schema=$1', ['public'])).rows.map((row) => row.table_name)).toContain(expected[owner]);
      } finally { await pool.end(); }
    });
  }

  it('PostgreSQL rejects unavailable connections within the configured timeout', async () => {
    const environment = inject('environment');
    const url = new URL(environment.adminUrl); url.port = '1';
    const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 200 });
    const started = performance.now();
    try { await expect(pool.query('SELECT 1')).rejects.toThrow(); expect(performance.now() - started).toBeLessThan(2000); }
    finally { await pool.end(); }
  });
});
