import { register } from 'node:module';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { StructuredLogger } from './logger.js';
import { recordGauge, resetMetricInstruments } from './metrics.js';

export interface TelemetryRuntime { readonly logger: StructuredLogger; readonly enabled: boolean; shutdown(): Promise<void> }
let runtime: Promise<TelemetryRuntime> | undefined;

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback); return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

/** Call before dynamic importing Nest, HTTP, pg and Redis modules. */
export function initializeTelemetry(defaultServiceName: string): Promise<TelemetryRuntime> {
  runtime ??= initialize(defaultServiceName);
  return runtime;
}
async function initialize(defaultServiceName: string): Promise<TelemetryRuntime> {
  // Nest loads these files later; telemetry needs the same environment earlier.
  loadEnv({ path: [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')], quiet: true });
  const service = process.env.OTEL_SERVICE_NAME || defaultServiceName;
  const logger = new StructuredLogger({ service });
  const noop: TelemetryRuntime = { logger, enabled: false, shutdown: async () => {} };
  if (process.env.OTEL_ENABLED !== 'true') return noop;
  try {
    if ((process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/protobuf') !== 'http/protobuf') {
      logger.warn('Telemetry disabled: only OTLP HTTP/protobuf is configured'); return noop;
    }
    const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318');
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      logger.warn('Telemetry disabled: invalid OTLP endpoint'); return noop;
    }
    // Official ESM loader hook; register() avoids CLI-only coverage gaps in verifiers.
    register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
    const { startSdk } = await import('./sdk.js');
    const sdk = startSdk({ service, environment: process.env.DEPLOYMENT_ENVIRONMENT ?? 'development', endpoint: endpoint.href.replace(/\/$/, ''), sampleRatio: boundedNumber(process.env.OTEL_SAMPLE_RATIO, 1, 0, 1), exportInterval: boundedNumber(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS, 5_000, 1_000, 60_000), logger });
    resetMetricInstruments();
    recordGauge('service_up', 1);
    let shutdown: Promise<void> | undefined;
    const result: TelemetryRuntime = {
      logger, enabled: true,
      shutdown: () => shutdown ??= (async () => {
        recordGauge('service_up', 0);
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([sdk.shutdown(), new Promise<void>(resolveTimeout => { timer = setTimeout(resolveTimeout, 5_000); timer.unref(); })]);
        } catch { /* Shutdown remains bounded when the Collector is offline. */ }
        finally { if (timer) clearTimeout(timer); }
      })(),
    };
    process.once('beforeExit', () => { void result.shutdown(); });
    logger.log('OpenTelemetry initialized');
    return result;
  } catch {
    logger.warn('Telemetry initialization failed; service continues without exporters');
    return noop;
  }
}
