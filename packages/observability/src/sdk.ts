import { NodeSDK } from '@opentelemetry/sdk-node';
import { randomUUID } from 'node:crypto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { setGlobalErrorHandler } from '@opentelemetry/core';
import { PrivacySpanProcessor } from './privacy-processor.js';
import { SafeMetricExporter } from './metric-exporter.js';
import { removeExistingPropagationHeaders } from './undici-headers.js';
import { TraceparentPropagator } from './traceparent-propagator.js';
import { safeMetricAttributes } from './metric-privacy.js';
import type { StructuredLogger } from './logger.js';

interface SdkOptions { service: string; environment: string; endpoint: string; sampleRatio: number; exportInterval: number; logger: StructuredLogger }
export function startSdk(options: SdkOptions): NodeSDK {
  let nextWarning = 0;
  setGlobalErrorHandler(() => {
    if (Date.now() >= nextWarning) { nextWarning = Date.now() + 60_000; options.logger.warn('Telemetry export unavailable; business operations continue'); }
  });
  const exporterOptions = { timeoutMillis: 3_000, concurrencyLimit: 1 };
  const sdk = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({ 'service.name': options.service, 'service.version': '1.0.0', 'service.instance.id': randomUUID(), 'deployment.environment.name': options.environment }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(options.sampleRatio) }),
    textMapPropagator: new TraceparentPropagator(),
    views: [{ instrumentName: '*', attributesProcessors: [{ process: safeMetricAttributes }], aggregationCardinalityLimit: 512 }],
    spanLimits: { attributeCountLimit: 40, attributeValueLengthLimit: 512, eventCountLimit: 20 },
    spanProcessors: [new PrivacySpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ ...exporterOptions, url: `${options.endpoint}/v1/traces` }), { maxQueueSize: 1_024, maxExportBatchSize: 128, scheduledDelayMillis: 1_000, exportTimeoutMillis: 3_000 }))],
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new SafeMetricExporter({ ...exporterOptions, url: `${options.endpoint}/v1/metrics` }), exportIntervalMillis: options.exportInterval, exportTimeoutMillis: Math.min(3_000, options.exportInterval) })],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ ...exporterOptions, url: `${options.endpoint}/v1/logs` }), maxQueueSize: 1_024, maxExportBatchSize: 128, scheduledDelayMillis: 1_000, exportTimeoutMillis: 3_000 })],
    instrumentations: [
      new HttpInstrumentation({ headersToSpanAttributes: {}, ignoreOutgoingRequestHook: request => String(request.hostname ?? request.host ?? '') === new URL(options.endpoint).hostname && Number(request.port ?? 80) === Number(new URL(options.endpoint).port || 80) }),
      new UndiciInstrumentation({ headersToSpanAttributes: {}, requestHook: (_span, request) => removeExistingPropagationHeaders(request), ignoreRequestHook: request => request.origin === new URL(options.endpoint).origin }),
      new PgInstrumentation({ enhancedDatabaseReporting: false, addSqlCommenterCommentToQueries: false, enableTraceContextPropagation: false }),
      new RedisInstrumentation({ dbStatementSerializer: command => command.toUpperCase() }),
      new NestInstrumentation(), new ExpressInstrumentation(),
    ],
  });
  sdk.start();
  return sdk;
}
