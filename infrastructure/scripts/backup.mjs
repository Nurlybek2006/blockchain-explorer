import { backupDatabases, parseArguments } from './postgres-archive.mjs';

try {
  const args = parseArguments(process.argv.slice(2), ['container', 'directory', 'user']);
  if (!args.container) throw new Error('Usage: node --env-file=.env.production infrastructure/scripts/backup.mjs --container CONTAINER [--directory backups] [--user USER]');
  const result = await backupDatabases({ container: args.container, directory: args.directory ?? 'backups', user: args.user ?? process.env.POSTGRES_USER ?? 'blockchain_admin' });
  console.log(`Backup complete: ${result.directory} (${result.manifest.databases.length} databases)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backup failed');
  process.exitCode = 1;
}
