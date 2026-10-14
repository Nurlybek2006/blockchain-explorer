import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { context, propagation } from '@opentelemetry/api';
import { sanitizeText } from './sanitize.js';

export interface TraceCarrier { traceparent?: string; tracestate?: string; 'x-request-id'?: string }
const requestIds = new AsyncLocalStorage<string>();

export function validRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) && sanitizeText(value) === value ? value : undefined;
}
export function currentRequestId(): string | undefined { return requestIds.getStore(); }
export function withRequestId<T>(value: unknown, work: () => T): T { return requestIds.run(validRequestId(value) ?? randomUUID(), work); }

export function validatedTraceCarrier(input: unknown): TraceCarrier {
  if (!input || typeof input !== 'object') return {};
  const result: TraceCarrier = {};
  const fields = Object.entries(input);
  const parent = fields.find(([key]) => key.toLowerCase() === 'traceparent')?.[1];
  const requestId = fields.find(([key]) => key.toLowerCase() === 'x-request-id')?.[1];
  if (typeof parent === 'string' && /^00-(?!0{32})[a-f0-9]{32}-(?!0{16})[a-f0-9]{16}-[a-f0-9]{2}$/.test(parent)) result.traceparent = parent;
  // No vendor state is required here; arbitrary tracestate could contain secrets.
  const id = validRequestId(requestId); if (id) result['x-request-id'] = id;
  return result;
}

export function injectTraceContext(): TraceCarrier {
  const carrier: Record<string, string> = {};
  try { propagation.inject(context.active(), carrier); } catch { /* Telemetry cannot change business work. */ }
  const id = currentRequestId(); if (id) carrier['x-request-id'] = id;
  return validatedTraceCarrier(carrier);
}
export function propagationHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(injectTraceContext())) if (typeof value === 'string') headers[key] = value;
  return headers;
}
export function withTraceContext<T>(input: unknown, work: () => T): T {
  const carrier = validatedTraceCarrier(input);
  let parent = context.active();
  try { parent = propagation.extract(parent, carrier); } catch { /* Malformed carriers are ignored. */ }
  return withRequestId(carrier['x-request-id'] ?? currentRequestId(), () => context.with(parent, work));
}
