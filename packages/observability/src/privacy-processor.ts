import type { Attributes, Context, SpanContext } from '@opentelemetry/api';
import type { SpanProcessor, Span, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { isSensitiveAttribute } from './attributes.js';
import { sanitizeText } from './sanitize.js';

function attributes(input: Attributes): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveAttribute(key)) continue;
    output[key] = typeof value === 'string' ? sanitizeText(value) : Array.isArray(value) ? value.map(item => sanitizeText(String(item))) : value;
  }
  return output;
}
function safeContext(context: SpanContext): SpanContext {
  return { traceId: context.traceId, spanId: context.spanId, traceFlags: context.traceFlags, ...(context.isRemote !== undefined ? { isRemote: context.isRemote } : {}) };
}

/** Final export boundary also protects auto-instrumented SQL, URLs and exceptions. */
export class PrivacySpanProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}
  onStart(span: Span, parent: Context): void { this.delegate.onStart(span, parent); }
  onEnd(span: ReadableSpan): void {
    const safe: ReadableSpan = {
      name: sanitizeText(span.name), kind: span.kind, spanContext: () => safeContext(span.spanContext()), parentSpanContext: span.parentSpanContext ? safeContext(span.parentSpanContext) : undefined,
      startTime: span.startTime, endTime: span.endTime, duration: span.duration, ended: span.ended,
      resource: span.resource, instrumentationScope: span.instrumentationScope,
      status: { ...span.status, ...(span.status.message ? { message: sanitizeText(span.status.message) } : {}) },
      attributes: attributes(span.attributes), links: span.links.map(link => ({ ...link, context: safeContext(link.context), attributes: attributes(link.attributes ?? {}) })),
      events: span.events.map(event => ({ ...event, name: sanitizeText(event.name), attributes: attributes(event.attributes ?? {}) })),
      droppedAttributesCount: span.droppedAttributesCount, droppedEventsCount: span.droppedEventsCount, droppedLinksCount: span.droppedLinksCount,
    };
    try { this.delegate.onEnd(safe); } catch { /* Exporter failures cannot escape Span.end. */ }
  }
  async forceFlush(): Promise<void> { try { await this.delegate.forceFlush(); } catch { /* Best effort. */ } }
  async shutdown(): Promise<void> { try { await this.delegate.shutdown(); } catch { /* Best effort. */ } }
}
