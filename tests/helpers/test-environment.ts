import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(candidate, 'pnpm-workspace.yaml'))) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error('Workspace root not found');
    candidate = parent;
  }
  return candidate;
}
export const root = repositoryRoot();
export const databases = {
  identity: 'api-gateway', explorer: 'indexer-service', portfolio: 'portfolio-service',
} as const;
export type DatabaseOwner = keyof typeof databases;
export interface TestEnvironment {
  postgresId: string;
  rabbitId: string;
  postgresUser: string;
  adminUrl: string;
  databaseUrls: Record<DatabaseOwner, string>;
  redisUrl: string;
  rabbitUrl: string;
  rabbitManagementUrl: string;
  rabbitUsername: string;
  rabbitPassword: string;
  runId: string;
}

export async function migrateDatabase(owner: DatabaseOwner, url: string, folder?: string): Promise<void> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try { await migrate(drizzle(pool), { migrationsFolder: folder ?? resolve(root, 'apps', databases[owner], 'src/database/migrations') }); }
  finally { await pool.end(); }
}

export function databaseUrl(adminUrl: string, database: string): string {
  if (!/^tc_[a-z0-9_]+$/.test(database)) throw new Error('Disposable test database name required');
  const url = new URL(adminUrl); url.pathname = `/${database}`; return url.toString();
}

export async function createDatabase(adminUrl: string, database: string): Promise<string> {
  const url = databaseUrl(adminUrl, database);
  const pool = new Pool({ connectionString: adminUrl });
  try { await pool.query(`CREATE DATABASE "${database}"`); }
  finally { await pool.end(); }
  return url;
}

export async function startTestEnvironment(): Promise<{ environment: TestEnvironment; stop: () => Promise<void> }> {
  const containers: StartedTestContainer[] = [];
  const stop = async () => {
    const results = await Promise.allSettled(containers.reverse().map((container) => container.stop({ timeout: 20_000 })));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  };
  const password = randomBytes(24).toString('hex');
  const runId = randomBytes(8).toString('hex');
  try {
    const postgres = await new GenericContainer('postgres:17.11-alpine')
      .withEnvironment({ POSTGRES_USER: 'test_owner', POSTGRES_PASSWORD: password, POSTGRES_DB: 'postgres' })
      .withExposedPorts(5432).withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2)).start();
    containers.push(postgres);
    const redis = await new GenericContainer('redis:7.4.11-alpine')
      .withCommand(['redis-server', '--appendonly', 'yes']).withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections')).start();
    containers.push(redis);
    const rabbit = await new GenericContainer('rabbitmq:4.3.6-management-alpine')
      .withEnvironment({ RABBITMQ_DEFAULT_USER: 'test_owner', RABBITMQ_DEFAULT_PASS: password })
      .withExposedPorts(5672, 15672).withWaitStrategy(Wait.forLogMessage('Server startup complete')).withStartupTimeout(120_000).start();
    containers.push(rabbit);
    const adminUrl = `postgresql://test_owner:${password}@${postgres.getHost()}:${postgres.getMappedPort(5432)}/postgres`;
    const urls = { identity: '', explorer: '', portfolio: '' };
    for (const owner of Object.keys(databases) as DatabaseOwner[]) {
      urls[owner] = await createDatabase(adminUrl, `tc_${owner}_${runId}`);
      await migrateDatabase(owner, urls[owner]);
    }
    return { environment: {
      postgresId: postgres.getId(), rabbitId: rabbit.getId(), postgresUser: 'test_owner', adminUrl, databaseUrls: urls, runId,
      redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}/0`,
      rabbitUrl: `amqp://test_owner:${password}@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`,
      rabbitManagementUrl: `http://${rabbit.getHost()}:${rabbit.getMappedPort(15672)}`,
      rabbitUsername: 'test_owner', rabbitPassword: password,
    }, stop };
  } catch (error) { await stop(); throw error; }
}
