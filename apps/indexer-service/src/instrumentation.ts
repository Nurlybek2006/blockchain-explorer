import { initializeTelemetry } from '@blockchain-explorer/observability/instrumentation';
export const telemetry = await initializeTelemetry('blockchain-explorer-indexer');
