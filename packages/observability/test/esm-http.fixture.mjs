import { register } from 'node:module';
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

const { NodeSDK } = await import('@opentelemetry/sdk-node');
const { InMemorySpanExporter, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
const { UndiciInstrumentation } = await import('@opentelemetry/instrumentation-undici');
const { InMemoryMetricExporter, PeriodicExportingMetricReader, AggregationTemporality } = await import('@opentelemetry/sdk-metrics');
const { removeExistingPropagationHeaders } = await import('../dist/undici-headers.js');
const { safeMetricAttributes } = await import('../dist/metric-privacy.js');
const { TraceparentPropagator } = await import('../dist/traceparent-propagator.js');
const { PrivacySpanProcessor } = await import('../dist/privacy-processor.js');
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
const exporter = new InMemorySpanExporter();
const sdk = new NodeSDK({ autoDetectResources: false, textMapPropagator: new TraceparentPropagator(), spanProcessors: [new PrivacySpanProcessor(new SimpleSpanProcessor(exporter))], metricReaders: [reader], views: [{ instrumentName: '*', attributesProcessors: [{ process: safeMetricAttributes }], aggregationCardinalityLimit: 512 }], instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation({ requestHook: (_span, request) => removeExistingPropagationHeaders(request) })] });
sdk.start();

// Application dependencies deliberately load after hooks and SDK setup.
const http = await import('node:http');
const { StructuredLogger, requestTelemetry, withTraceContext, propagationHeaders } = await import('../dist/index.js');
const lines = [];
const logger = new StructuredLogger({ service: 'blockchain-explorer-api', format: 'json', sink: line => lines.push(JSON.parse(line)) });
let observedCarrier;
let observedState;
const internal = http.createServer((request, response) => {
  observedCarrier = request.headers.traceparent;
  observedState = request.headers.tracestate;
  request.route = { path: '/health' };
  requestTelemetry('blockchain-explorer-indexer', logger)(request, response, () => response.end('healthy'));
});
await new Promise(resolve => internal.listen(0, '127.0.0.1', resolve));
const internalPort = internal.address().port;
const gateway = http.createServer((request, response) => {
  request.route = { path: '/health' };
  requestTelemetry('blockchain-explorer-api', logger)(request, response, () => {
    void fetch(`http://127.0.0.1:${internalPort}/health`, { headers: propagationHeaders() }).then(result => result.text()).then(() => response.end('healthy'));
  });
});
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
const gatewayPort = gateway.address().port;
const incoming = '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01';
const result = await withTraceContext({ traceparent: incoming, 'x-request-id': 'esm-fixture-request' }, () => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${gatewayPort}/health`, { headers: { traceparent: incoming, tracestate: 'vendor=fixture-tracestate-secret', 'x-request-id': 'esm-fixture-request', forwarded: 'host=fixture-untrusted-host.invalid;proto=fixture-untrusted-proto', 'x-forwarded-host': 'fixture-untrusted-host.invalid', 'x-forwarded-proto': 'fixture-untrusted-proto' } }, response => {
    response.resume(); response.once('end', () => resolve({ status: response.statusCode, requestId: response.headers['x-request-id'] }));
  }).once('error', reject);
}));
await new Promise(resolve => gateway.close(resolve));
await new Promise(resolve => internal.close(resolve));
const spans = exporter.getFinishedSpans().map(span => ({ name: span.name, kind: span.kind, traceId: span.spanContext().traceId, spanId: span.spanContext().spanId, parentSpanId: span.parentSpanContext?.spanId, requestId: span.attributes['request.id'], tracestate: span.spanContext().traceState?.serialize(), parentTracestate: span.parentSpanContext?.traceState?.serialize() }));
await reader.forceFlush();
const metrics = metricExporter.getMetrics().flatMap(resource => resource.scopeMetrics.flatMap(scope => scope.metrics.map(metric => ({ name: metric.descriptor.name, attributes: metric.dataPoints.map(point => point.attributes) }))));
await sdk.shutdown();
process.stdout.write(JSON.stringify({ result, observedCarrier, observedState, spans, logs: lines, metrics }));
