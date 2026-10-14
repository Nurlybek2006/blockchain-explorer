import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { InMemoryMetricExporter, PeriodicExportingMetricReader, AggregationTemporality, type InstrumentType } from '@opentelemetry/sdk-metrics';
import { InMemoryLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { context, trace, SpanStatusCode, createTraceState } from '@opentelemetry/api';
import { PrivacySpanProcessor } from './privacy-processor.js';
import { withSpan, recordSpanError } from './tracing.js';
import { currentRequestId, injectTraceContext, withTraceContext, withRequestId, validatedTraceCarrier } from './context.js';
import { StructuredLogger } from './logger.js';
import { recordCounter, recordHistogram, recordGauge, registerPoolMetrics, resetMetricInstruments } from './metrics.js';
import { metricTemporality } from './metric-exporter.js';
import { TraceparentPropagator } from './traceparent-propagator.js';
import { safeMetricAttributes } from './metric-privacy.js';

const spans = new InMemorySpanExporter();
const logExporter = new InMemoryLogRecordExporter();
class InMemoryApplicationExporter extends InMemoryMetricExporter {
  override selectAggregationTemporality(type: InstrumentType): AggregationTemporality { return metricTemporality(type); }
}
const metricExporter = new InMemoryApplicationExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
const sdk = new NodeSDK({ autoDetectResources: false, spanProcessors: [new PrivacySpanProcessor(new SimpleSpanProcessor(spans))], metricReaders: [reader], logRecordProcessors: [new SimpleLogRecordProcessor({ exporter: logExporter })], views: [{ instrumentName: '*', attributesProcessors: [{ process: safeMetricAttributes }], aggregationCardinalityLimit: 512 }], instrumentations: [] });
beforeAll(() => { sdk.start(); resetMetricInstruments(); });
beforeEach(() => { spans.reset(); logExporter.reset(); vi.restoreAllMocks(); });
afterAll(async () => { await sdk.shutdown(); });

describe('application spans and propagation', () => {
  it('preserves the business result and parent hierarchy for block processing spans', async () => {
    expect(await withSpan('indexer.process_block', { 'ethereum.block_number': '100' }, () => withSpan('indexer.persist_block', {}, () => 42))).toBe(42);
    const finished = spans.getFinishedSpans();
    const parent = finished.find(span => span.name === 'indexer.process_block');
    const child = finished.find(span => span.name === 'indexer.persist_block');
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
  });
  it('marks errors and records sanitized exception without swallowing the error', async () => {
    const failure = new Error('password=fixture-password');
    await expect(withSpan('ethereum.rpc', {}, () => { throw failure; })).rejects.toBe(failure);
    const span = spans.getFinishedSpans()[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(JSON.stringify(span.events)).not.toContain('fixture-password');
    expect(span.events[0].name).toBe('exception');
  });
  it('propagates async message context through a serialized RabbitMQ header carrier', async () => {
    let carrier: unknown;
    await withRequestId('request-fixture', () => withSpan('rabbitmq.publish', {}, () => { carrier = JSON.parse(JSON.stringify(injectTraceContext())); }));
    await withTraceContext(carrier, () => withSpan('rabbitmq.consume', {}, () => expect(currentRequestId()).toBe('request-fixture')));
    const [producer, consumer] = spans.getFinishedSpans();
    expect(consumer.spanContext().traceId).toBe(producer.spanContext().traceId);
    expect(consumer.parentSpanContext?.spanId).toBe(producer.spanContext().spanId);
  });
  it('restores BullMQ metadata context independently of job data', async () => {
    let metadata = '';
    await withSpan('bullmq.enqueue', {}, () => { metadata = JSON.stringify(injectTraceContext()); });
    await withTraceContext(JSON.parse(metadata), () => withSpan('bullmq.job', {}, () => 'completed'));
    const [producer, consumer] = spans.getFinishedSpans();
    expect(consumer.parentSpanContext?.spanId).toBe(producer.spanContext().spanId);
  });
  it('ignores invalid trace IDs, arbitrary vendor state and unsafe request IDs', () => {
    expect(validatedTraceCarrier({ traceparent: '00-' + '0'.repeat(32) + '-' + '0'.repeat(16) + '-01', tracestate: 'vendor=fixture-key', 'x-request-id': '\r\nunsafe' })).toEqual({});
    process.env.OBSERVABILITY_TEST_API_KEY = 'syntheticApiKeyThatFitsRequestId123';
    try {
      expect(validatedTraceCarrier({ 'x-request-id': process.env.OBSERVABILITY_TEST_API_KEY })).toEqual({});
      withRequestId(process.env.OBSERVABILITY_TEST_API_KEY, () => {
        expect(currentRequestId()).not.toBe(process.env.OBSERVABILITY_TEST_API_KEY);
        expect(currentRequestId()).toMatch(/^[a-f0-9-]{36}$/);
      });
    } finally { delete process.env.OBSERVABILITY_TEST_API_KEY; }
  });
  it('runs business work if the tracer fails to initialize', async () => {
    vi.spyOn(trace, 'getTracer').mockImplementation(() => { throw new Error('telemetry unavailable'); });
    expect(await withSpan('indexer.process_block', {}, () => 'business-success')).toBe('business-success');
  });
  it('sanitizes auto-instrumented SQL, headers, URLs and status text at export', () => {
    const span = trace.getTracer('privacy-fixture').startSpan('database.query', { attributes: { 'db.statement': 'SELECT fixture-password', 'http.url': 'https://example.invalid?key=fixture-key', Authorization: 'fixture-auth', safe: 'value' } });
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'api_key=fixture-key' }); span.end();
    const finished = spans.getFinishedSpans()[0];
    expect(finished.attributes).toEqual({ safe: 'value' }); expect(finished.status.message).not.toContain('fixture-key');
  });
  it('strips vendor tracestate from exported spans, parent contexts and links', () => {
    const remote = { traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef', traceFlags: 1, isRemote: true, traceState: createTraceState('vendor=fixture-vendor-secret') };
    const parent = trace.setSpanContext(context.active(), remote);
    const span = trace.getTracer('privacy-fixture').startSpan('vendor.fixture', { links: [{ context: remote }] }, parent); span.end();
    const exported = spans.getFinishedSpans()[0];
    expect(exported.spanContext().traceState).toBeUndefined();
    expect(exported.parentSpanContext?.traceState).toBeUndefined();
    expect(exported.links[0].context.traceState).toBeUndefined();
    expect(exported.spanContext().traceId).toBe(remote.traceId);
  });
  it('extracts and injects only traceparent even when a caller supplies vendor state', () => {
    const propagator = new TraceparentPropagator();
    const input = { traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01', tracestate: 'vendor=fixture-vendor-secret' };
    const parent = propagator.extract(context.active(), input, { keys: carrier => Object.keys(carrier), get: (carrier, key) => key === 'traceparent' ? carrier.traceparent : carrier.tracestate });
    expect(trace.getSpanContext(parent)?.traceState).toBeUndefined();
    const output: Record<string, string> = {};
    propagator.inject(parent, output, { set: (carrier, key, value) => { carrier[key] = value; } });
    expect(output).toEqual({ traceparent: input.traceparent });
  });
});

describe('structured log correlation', () => {
  it('correlates JSON logs and exported log records with the active span and request', async () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ service: 'blockchain-explorer-api', format: 'json', sink: line => lines.push(line) });
    await withRequestId('request-log-fixture', () => withSpan('http.request', {}, () => logger.log('request completed', { password: 'fixture-secret' })));
    const body: unknown = JSON.parse(lines[0]);
    const record = logExporter.getFinishedLogRecords()[0];
    expect(body).toMatchObject({ service: 'blockchain-explorer-api', requestId: 'request-log-fixture', traceId: spans.getFinishedSpans()[0].spanContext().traceId, context: { password: '[REDACTED]' } });
    expect(record.spanContext?.traceId).toBe(spans.getFinishedSpans()[0].spanContext().traceId);
    expect(spans.getFinishedSpans()[0].attributes['request.id']).toBe('request-log-fixture');
    expect(record.body).toBe(lines[0]);
  });
  it('writes logs with no active span and tolerates unavailable stdout', () => {
    const lines: string[] = [];
    new StructuredLogger({ service: 'blockchain-explorer-api', format: 'json', sink: line => lines.push(line) }).log('started');
    expect(JSON.parse(lines[0])).not.toHaveProperty('traceId');
    expect(() => new StructuredLogger({ service: 'test', sink: () => { throw new Error('stdout closed'); } }).error('error')).not.toThrow();
  });
});

describe('real meter recording', () => {
  it('counts a handled ERROR span as an error without changing its successful business result', async () => {
    const result = await withSpan('rabbitmq.consume', {}, span => { recordSpanError(span, new Error('fixture handled delivery')); return 'delivery-nacked'; });
    expect(result).toBe('delivery-nacked'); expect(spans.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
    await reader.forceFlush();
    const exported = metricExporter.getMetrics().at(-1)?.scopeMetrics.flatMap(scope => scope.metrics) ?? [];
    const counter = exported.find(metric => metric.descriptor.name === 'app_spans_total');
    expect(counter?.dataPoints.some(point => point.attributes.operation === 'rabbitmq.consume' && point.attributes.status === 'error' && typeof point.value === 'number' && point.value >= 1)).toBe(true);
  });
  it('applies privacy views before aggregating automatically generated metric dimensions', async () => {
    const { metrics } = await import('@opentelemetry/api');
    const histogram = metrics.getMeter('auto-instrumentation-fixture').createHistogram('fixture.auto.request.duration', { unit: 's' });
    histogram.record(0.01, { 'http.request.method': 'GET', 'http.response.status_code': 200, 'http.route': '/tx/:hash', 'server.address': 'untrusted-forwarded-host', 'url.scheme': 'untrusted-forwarded-proto', 'db.user': 'fixture-secret-user', Authorization: 'fixture-secret-auth' });
    await reader.forceFlush();
    const exported = metricExporter.getMetrics().at(-1)?.scopeMetrics.flatMap(scope => scope.metrics) ?? [];
    expect(exported.find(metric => metric.descriptor.name === 'fixture.auto.request.duration')?.dataPoints[0].attributes).toEqual({ 'http.request.method': 'GET', 'http.response.status_code': 200, 'http.route': '/tx/:hash' });
  });
  it('exports application counters and seconds histograms with safe dimensions', async () => {
    recordCounter('indexer_blocks_processed_total', 2);
    recordCounter('ethereum_rpc_retries_total', 1, { method: 'eth_getBlockByNumber' });
    recordCounter('ethereum_rpc_rate_limited_total', 1, { method: 'eth_getBlockByNumber' });
    recordCounter('cache_hits_total', 1, { namespace: 'explorer' }); recordCounter('cache_misses_total', 1, { namespace: 'price' });
    recordCounter('rabbitmq_published_total', 1, { event_type: 'block.indexed.v1' }); recordCounter('rabbitmq_consumed_total', 1, { event_type: 'block.indexed.v1' });
    recordCounter('bullmq_jobs_completed_total', 1, { queue: 'portfolio-jobs', job: 'sync-token-holding' }); recordCounter('bullmq_jobs_failed_total', 1, { queue: 'portfolio-jobs', job: 'sync-token-holding' });
    recordCounter('websocket_connections_total'); recordCounter('websocket_disconnects_total');
    recordHistogram('http.server.duration', 0.025, { route: '/tx/:hash', method: 'GET', status_code: 200 });
    await reader.forceFlush();
    const exported = metricExporter.getMetrics().flatMap(resource => resource.scopeMetrics.flatMap(scope => scope.metrics));
    expect(exported.find(metric => metric.descriptor.name === 'indexer_blocks_processed_total')?.dataPoints[0].value).toBe(2);
    for (const name of ['ethereum_rpc_retries_total','ethereum_rpc_rate_limited_total','cache_hits_total','cache_misses_total','rabbitmq_published_total','rabbitmq_consumed_total','bullmq_jobs_completed_total','bullmq_jobs_failed_total','websocket_connections_total','websocket_disconnects_total']) expect(exported.some(metric => metric.descriptor.name === name)).toBe(true);
    const duration = exported.find(metric => metric.descriptor.name === 'http.server.duration');
    expect(duration?.descriptor.unit).toBe('s'); expect(duration?.dataPoints[0].attributes).toMatchObject({ route: '/tx/:hash' });
  });
  it('collects pg pool gauges and releases their callbacks on shutdown', async () => {
    const stop = registerPoolMetrics({ totalCount: 4, idleCount: 3, waitingCount: 1 }, 'explorer_db');
    recordGauge('indexer_lag_blocks', 8); await reader.forceFlush();
    const exported = metricExporter.getMetrics().at(-1)?.scopeMetrics.flatMap(scope => scope.metrics) ?? [];
    expect(exported.find(metric => metric.descriptor.name === 'db_pool_total')?.dataPoints[0].value).toBe(4);
    expect(exported.find(metric => metric.descriptor.name === 'indexer_lag_blocks')?.dataPoints[0].value).toBe(8);
    stop(); recordGauge('indexer_lag_blocks', null); await reader.forceFlush();
    const latest = metricExporter.getMetrics().at(-1)?.scopeMetrics.flatMap(scope => scope.metrics) ?? [];
    expect(latest.find(metric => metric.descriptor.name === 'indexer_lag_blocks')?.dataPoints.length ?? 0).toBe(0);
  });
});
