import { describe, expect, inject, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { backupDatabases, restoreDatabase } from '../../infrastructure/scripts/postgres-archive.mjs';
import { createDatabase, type DatabaseOwner } from '../helpers/test-environment.js';

describe('real disposable PostgreSQL backup and guarded restore', () => {
  it('backs up all three migrated databases, restores them to empty databases and checks rows/indexes', async () => {
    const environment = inject('environment');
    const directory = await mkdtemp(resolve(tmpdir(), 'explorer-archives-'));
    const sources = Object.keys(environment.databaseUrls) as DatabaseOwner[];
    const password = decodeURIComponent(new URL(environment.adminUrl).password);
    const databaseNames = sources.map((owner) => new URL(environment.databaseUrls[owner]).pathname.slice(1));
    try {
      for (const owner of sources) {
        const pool = new Pool({ connectionString: environment.databaseUrls[owner] });
        try {
          await pool.query('CREATE TABLE archive_sentinel (id integer PRIMARY KEY, note text NOT NULL)');
          await pool.query('INSERT INTO archive_sentinel VALUES (1,$1)', [`${owner}:exact-data`]);
        } finally { await pool.end(); }
      }
      const backup = await backupDatabases({ container: environment.postgresId, user: environment.postgresUser, password, directory, databases: databaseNames });
      expect(backup.manifest.databases.length).toBe(3);
      for (const item of backup.manifest.databases) { expect(item.bytes).toBeGreaterThan(0); expect(item.sha256).toMatch(/^[\da-f]{64}$/); }
      for (const owner of sources) {
        const target = `tc_restore_${owner}_${environment.runId}`;
        const targetUrl = await createDatabase(environment.adminUrl, target);
        const source = new URL(environment.databaseUrls[owner]).pathname.slice(1);
        const options = { container: environment.postgresId, user: environment.postgresUser, password, directory: backup.directory, database: source, target, confirmation: `${environment.postgresId}/${target}` };
        await expect(restoreDatabase({ ...options, confirmation: 'wrong-target' })).rejects.toThrow();
        await restoreDatabase(options);
        const pool = new Pool({ connectionString: targetUrl });
        try {
          expect((await pool.query<{ note: string }>('SELECT note FROM archive_sentinel')).rows[0]?.note).toBe(`${owner}:exact-data`);
          const indexCount = await pool.query<{ count: string }>("SELECT count(*) FROM pg_indexes WHERE schemaname='public'");
          expect(Number(indexCount.rows[0]?.count)).toBeGreaterThan(2);
          expect(Number((await pool.query<{ count: string }>('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0]?.count)).toBeGreaterThan(0);
        } finally { await pool.end(); }
        await expect(restoreDatabase(options)).rejects.toThrow();
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 90_000);
});
