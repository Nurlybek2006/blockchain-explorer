const { initializeTelemetry } = await import('../dist/instrumentation.js');
const runtime = await initializeTelemetry('blockchain-explorer-api');
await runtime.shutdown();
process.stdout.write(JSON.stringify({ enabled: runtime.enabled }) + '\n');
