import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const entrypoint = process.argv[2];
if (!entrypoint) throw new Error('Compiled application entrypoint required');
const require = createRequire(resolve(dirname(entrypoint), '../package.json'));
await import(pathToFileURL(resolve(dirname(entrypoint), 'instrumentation.js')).href);
const { NestFactory } = await import(pathToFileURL(require.resolve('@nestjs/core')).href);
const create = NestFactory.create.bind(NestFactory);
let application;
NestFactory.create = async (...arguments_) => { application = await create(...arguments_); return application; };
await import(pathToFileURL(resolve(entrypoint)).href);
process.on('message', async (message) => {
  // Windows cannot deliver a POSIX signal gracefully through child.kill().
  // Invoke the real Nest close('SIGTERM') lifecycle through a test-only bridge.
  // Linux production Docker verification separately delivers the OS signal.
  if (message?.type === 'test-stop') { await application.close('SIGTERM'); process.disconnect(); }
});
