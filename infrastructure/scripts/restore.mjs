import { restoreDatabase, parseArguments } from './postgres-archive.mjs';

try {
  const args = parseArguments(process.argv.slice(2), ['container', 'directory', 'user', 'database', 'target', 'confirm']);
  if (!args.container || !args.directory || !args.database || !args.target || !args.confirm) throw new Error('Usage: node --env-file=.env.production infrastructure/scripts/restore.mjs --container CONTAINER --directory BACKUP --database SOURCE --target EMPTY_TARGET --confirm CONTAINER/EMPTY_TARGET [--user USER]');
  const result = await restoreDatabase({ container: args.container, directory: args.directory, user: args.user ?? process.env.POSTGRES_USER ?? 'blockchain_admin', database: args.database, target: args.target, confirmation: args.confirm });
  console.log(`Restore complete: ${result.database} -> ${result.target}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Restore failed');
  process.exitCode = 1;
}
