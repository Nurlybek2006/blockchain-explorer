import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface FixtureOutput { result: { status: number; requestId: string }; observedCarrier: string; observedState?: string; spans: { traceId: string; spanId: string; parentSpanId?: string; kind: number; requestId?: string }[]; logs: { traceId?: string; spanId?: string; requestId?: string }[]; metrics: { name: string; attributes: Record<string, unknown>[] }[] }
describe('actual compiled ESM HTTP instrumentation', () => {
  it('accepts a valid one-second metric interval while the exporter is offline', async () => {
    const fixture = fileURLToPath(new URL('../test/runtime.fixture.mjs', import.meta.url));
    const result = await promisify(execFile)(process.execPath, [fixture], { timeout: 15_000, maxBuffer: 1_048_576, env: { ...process.env, OTEL_ENABLED: 'true', OTEL_METRIC_EXPORT_INTERVAL_MS: '1000', OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', LOG_FORMAT: 'json' } });
    expect(JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '')).toEqual({ enabled: true });
  }, 20_000);
  it('initializes before imports and propagates HTTP -> gateway -> fetch/internal HTTP with correlated logs', async () => {
    const fixture = fileURLToPath(new URL('../test/esm-http.fixture.mjs', import.meta.url));
    const result = await promisify(execFile)(process.execPath, [fixture], { timeout: 15_000, maxBuffer: 1_048_576 });
    const output: FixtureOutput = JSON.parse(result.stdout);
    expect(output.result).toEqual({ status: 200, requestId: 'esm-fixture-request' });
    expect(output.observedCarrier).toMatch(/^00-1234567890abcdef1234567890abcdef-/);
    expect(output.observedState).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain('fixture-tracestate-secret');
    const serverSpans = output.spans.filter(span => span.kind === 1);
    expect(serverSpans).toHaveLength(2);
    expect(serverSpans.every(span => span.traceId === '1234567890abcdef1234567890abcdef')).toBe(true);
    expect(serverSpans.every(span => span.requestId === 'esm-fixture-request')).toBe(true);
    expect(output.spans.some(span => span.kind === 2)).toBe(true);
    expect(output.logs).toHaveLength(2);
    expect(output.logs.every(log => log.traceId === '1234567890abcdef1234567890abcdef' && log.spanId)).toBe(true);
    expect(output.logs.some(log => log.requestId === 'esm-fixture-request')).toBe(true);
    expect(output.metrics.some(metric => metric.name === 'http.server.request.duration')).toBe(true);
    expect(JSON.stringify(output.metrics)).not.toContain('fixture-untrusted');
    expect(output.metrics.flatMap(metric => metric.attributes).every(attributes => !Object.hasOwn(attributes, 'server.address') && !Object.hasOwn(attributes, 'url.scheme'))).toBe(true);
  }, 20_000);
});
