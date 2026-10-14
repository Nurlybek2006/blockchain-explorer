import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const databasePattern = /^[a-z][a-z0-9_]{0,62}$/;
const containerPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const forbiddenDatabases = new Set(['postgres', 'template0', 'template1']);
function databaseName(value) {
  if (!databasePattern.test(value) || forbiddenDatabases.has(value)) throw new Error('Invalid application database name');
  return value;
}
function options(input) {
  if (!containerPattern.test(input.container) || !databasePattern.test(input.user)) throw new Error('Invalid container or PostgreSQL user');
  return { ...input, password: input.password ?? process.env.POSTGRES_PASSWORD };
}

function startDocker(args, input, { stdin = false } = {}) {
  // -e NAME copies the child environment; credential values never enter argv.
  const child = spawn('docker', args, {
    env: { ...process.env, ...(input.password === undefined ? {} : { PGPASSWORD: input.password }) },
    stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const timeout = setTimeout(() => child.kill(), 120_000);
  timeout.unref();
  child.stderr.resume(); // Do not print raw driver diagnostics, URLs or passwords.
  const completion = new Promise((resolve, reject) => {
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Docker operation could not start')); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(); else reject(new Error('PostgreSQL archive operation failed; check target, credentials and server availability'));
    });
  });
  return { child, completion };
}

async function capture(args, input) {
  const { child, completion } = startDocker(args, input);
  let output = '';
  child.stdout.on('data', (data) => {
    output += data.toString('utf8');
    if (output.length > 16_384) child.kill();
  });
  await completion;
  return output.trim();
}
function execArgs(input, command, interactive = false) {
  return ['exec', ...(interactive ? ['-i'] : []), ...(input.password === undefined ? [] : ['-e', 'PGPASSWORD']), input.container, ...command];
}
function connection(input, database) {
  return ['--host=127.0.0.1', '--username', input.user, '--dbname', database];
}
async function inspect(input) {
  const [id, image, running] = (await capture(['inspect', '--format', '{{.Id}}|{{.Config.Image}}|{{.State.Running}}', input.container], input)).split('|');
  if (running !== 'true' || !/^postgres(?::|@)/.test(image ?? '') || !/^[a-f0-9]{64}$/.test(id ?? '')) throw new Error('Target must be a running official PostgreSQL container');
  return id;
}
async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Create custom-format archives using the pg_dump binary matching the server. */
export async function backupDatabases(input) {
  const config = options(input);
  const databases = input.databases ?? ['identity_db', 'explorer_db', 'portfolio_db'];
  if (!databases.length || databases.length > 20 || new Set(databases).size !== databases.length) throw new Error('Invalid database selection');
  databases.forEach(databaseName);
  // Inspect only the identity/image fields. No container environment is logged.
  const containerId = await inspect(config);
  const createdAt = new Date().toISOString();
  const directory = path.resolve(input.directory, `${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entries = [];
  for (const database of databases) {
    const archive = `${database}.dump`;
    const file = path.join(directory, archive);
    const { child, completion } = startDocker(execArgs(config, ['pg_dump', ...connection(config, database), '--format=custom', '--no-owner', '--no-acl']), config);
    await Promise.all([pipeline(child.stdout, createWriteStream(file, { flags: 'wx', mode: 0o600 })), completion]);
    entries.push({ database, archive, bytes: (await stat(file)).size, sha256: await checksum(file) });
  }
  const manifest = { version: 1, createdAt, containerId, databases: entries };
  // A partial backup has no manifest and cannot be restored by this helper.
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { directory, manifest };
}

/** Restore only to a pre-created empty application database; never drops data. */
export async function restoreDatabase(input) {
  const config = options(input);
  databaseName(input.database);
  databaseName(input.target);
  if (input.confirmation !== `${input.container}/${input.target}`) throw new Error('Restore requires explicit confirmation of the exact container/database target');
  await inspect(config);
  const directory = await realpath(path.resolve(input.directory));
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.databases)) throw new Error('Invalid backup manifest');
  const entry = manifest.databases.find((item) => item.database === input.database);
  if (!entry || entry.archive !== `${input.database}.dump` || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Requested database archive is missing');
  const archive = await realpath(path.join(directory, entry.archive));
  if (path.dirname(archive) !== directory || (await stat(archive)).size !== entry.bytes || await checksum(archive) !== entry.sha256) throw new Error('Archive path, size or checksum does not match the backup manifest');

  const query = "SELECT current_database(), count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f');";
  const proof = await capture(execArgs(config, ['psql', ...connection(config, input.target), '--no-psqlrc', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--command', query]), config);
  if (proof !== `${input.target}|0`) throw new Error('Restore target must already exist and contain no application tables, views or sequences');

  const { child, completion } = startDocker(execArgs(config, ['pg_restore', ...connection(config, input.target), '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'], true), config, { stdin: true });
  child.stdout.resume();
  await Promise.all([pipeline(createReadStream(archive), child.stdin), completion]);
  return { database: input.database, target: input.target };
}

export function parseArguments(argv, allowed) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!allowed.includes(key) || !value || value.startsWith('--') || key in parsed) throw new Error('Invalid command arguments');
    parsed[key] = value;
  }
  return parsed;
}
