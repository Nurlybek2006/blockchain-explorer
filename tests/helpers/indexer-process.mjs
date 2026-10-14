import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'apps/indexer-service/package.json'));
process.send?.({ type: 'test-startup-stage', stage: 'telemetry' });
const { telemetry } = await import(pathToFileURL(resolve(root, 'apps/indexer-service/dist/instrumentation.js')).href);
process.send?.({ type: 'test-startup-stage', stage: 'modules' });
await import(pathToFileURL(require.resolve('reflect-metadata')).href);
const { NestFactory } = await import(pathToFileURL(require.resolve('@nestjs/core')).href);
const { requestTelemetry } = await import('@blockchain-explorer/observability');
const { AppModule } = await import(pathToFileURL(resolve(root, 'apps/indexer-service/dist/app.module.js')).href);
const { BlockProcessorService } = await import(pathToFileURL(resolve(root, 'apps/indexer-service/dist/modules/chain-sync/block-processor.service.js')).href);
const { DatabaseService } = await import(pathToFileURL(resolve(root, 'apps/indexer-service/dist/database/database.service.js')).href);
const { EthereumRpcClient } = await import('@blockchain-explorer/blockchain-client');
process.send?.({ type: 'test-startup-stage', stage: 'nest-create' });
const app = await NestFactory.create({ module: AppModule, providers: [{ provide: 'TelemetryShutdown', useValue: { onApplicationShutdown: () => telemetry.shutdown() } }] }, { logger: telemetry.logger });
app.enableShutdownHooks();
app.use(requestTelemetry('blockchain-explorer-indexer', telemetry.logger));
await app.listen(Number(process.env.INDEXER_PORT), '127.0.0.1');
process.send?.({ type: 'test-startup-stage', stage: 'http-ready' });
const timings = new AsyncLocalStorage();
const database = app.get(DatabaseService);
const transaction = database.db.transaction.bind(database.db);
database.db.transaction = async (...args) => {
  const started = performance.now();
  try { return await transaction(...args); }
  finally { const timing = timings.getStore(); if (timing) timing.persistMs += performance.now() - started; }
};
const rpc = app.get(EthereumRpcClient);
const request = rpc.request.bind(rpc);
rpc.request = async (...args) => {
  const started = performance.now();
  try { return await request(...args); }
  finally { const timing = timings.getStore(); if (timing) timing.rpcWaitMs += performance.now() - started; }
};
process.on('message', async (message) => {
  if (message?.type === 'test-stop') { await app.close('SIGTERM'); process.disconnect(); }
  if (message?.type === 'test-process-block') {
    try {
      const measurement = { rpcWaitMs: 0, persistMs: 0, durationMs: 0, transactionCount: message.block.transactions.length };
      const started = performance.now();
      await timings.run(measurement, () => app.get(BlockProcessorService).process(11155111, 'ethereum-sepolia', message.block, BigInt(message.confirmedHead)));
      measurement.durationMs = performance.now() - started;
      process.send({ type: 'test-block-result', success: true, measurement });
    } catch (error) { process.send({ type: 'test-block-result', success: false, message: error instanceof Error ? error.message : 'Block processing failed' }); }
  }
});
