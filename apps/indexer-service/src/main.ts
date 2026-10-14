import { telemetry } from './instrumentation.js';

// Dynamic import ensures the SDK and ESM hooks precede Nest/pg/HTTP loading.
const { bootstrap } = await import('./bootstrap.js');
await bootstrap(telemetry);
