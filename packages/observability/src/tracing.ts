import { context, trace, SpanStatusCode, type Span, type SpanOptions } from '@opentelemetry/api';
import { safeAttributes, type TelemetryAttributes } from './attributes.js';
import { recordCounter, recordHistogram } from './metrics.js';
import { sanitizedException } from './sanitize.js';
import { currentRequestId } from './context.js';
const erroredSpans = new WeakSet<Span>();

export function recordSpanError(span: Span, error: unknown): void {
  try { erroredSpans.add(span); span.recordException(sanitizedException(error)); span.setStatus({ code: SpanStatusCode.ERROR, message: sanitizedException(error).message }); } catch { /* Never mask the business error. */ }
}

export async function withSpan<T>(name: string, attributes: TelemetryAttributes, work: (span: Span) => Promise<T> | T, options: SpanOptions = {}): Promise<T> {
  const started = performance.now();
  let span: Span;
  try { span = trace.getTracer('@blockchain-explorer/observability', '1.0.0').startSpan(name, { ...options, attributes: safeAttributes({ ...attributes, 'request.id': currentRequestId() }) }); }
  catch { span = trace.wrapSpanContext({ traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 }); }
  const parent = trace.setSpan(context.active(), span);
  let outcome = 'success';
  try { return await context.with(parent, () => work(span)); }
  catch (error) { outcome = 'error'; recordSpanError(span, error); throw error; }
  finally {
    if (erroredSpans.has(span)) outcome = 'error';
    erroredSpans.delete(span);
    recordCounter('app_spans_total', 1, { operation: name, status: outcome });
    recordHistogram('app_span_duration_seconds', (performance.now() - started) / 1_000, { operation: name });
    try { span.end(); } catch { /* Span exporters never alter the business result. */ }
  }
}
