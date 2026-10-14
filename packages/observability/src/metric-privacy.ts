import type { Attributes } from '@opentelemetry/api';
import { boundedRoute, metricAttributes } from './metrics.js';
import type { TelemetryAttributes } from './attributes.js';

const httpMethods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','CONNECT','TRACE']);

/** Universal view boundary covers instrumentations that do not use custom helpers. */
export function safeMetricAttributes(input: Attributes): Attributes {
  const primitive: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') primitive[key] = value;
  }
  const custom: TelemetryAttributes = primitive;
  const output = metricAttributes(custom);
  const method = input['http.request.method'];
  if (method !== undefined) output['http.request.method'] = typeof method === 'string' && httpMethods.has(method) ? method : '_OTHER';
  if (input['http.route'] !== undefined) output['http.route'] = boundedRoute(input['http.route']);
  const status = input['http.response.status_code'];
  if (status !== undefined) output['http.response.status_code'] = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  return output;
}

interface SafeExemplar { filteredAttributes: Attributes; value: number; timestamp: [number, number]; traceId?: string; spanId?: string }
/** Preserve metric-to-trace IDs while removing attributes excluded from aggregation. */
export function safeMetricExemplars(input: unknown): SafeExemplar[] {
  if (!Array.isArray(input)) return [];
  const output: SafeExemplar[] = [];
  for (const exemplar of input.slice(0, 32)) {
    if (!exemplar || typeof exemplar !== 'object') continue;
    const fields = new Map(Object.entries(exemplar));
    const value = fields.get('value'); const timestamp = fields.get('timestamp');
    if (typeof value !== 'number' || !Number.isFinite(value) || !Array.isArray(timestamp) || timestamp.length !== 2 || typeof timestamp[0] !== 'number' || typeof timestamp[1] !== 'number' || !Number.isFinite(timestamp[0]) || !Number.isFinite(timestamp[1])) continue;
    const safe: SafeExemplar = { filteredAttributes: {}, value, timestamp: [timestamp[0], timestamp[1]] };
    const traceId = fields.get('traceId'); const spanId = fields.get('spanId');
    if (typeof traceId === 'string' && /^[a-f0-9]{32}$/.test(traceId)) safe.traceId = traceId;
    if (typeof spanId === 'string' && /^[a-f0-9]{16}$/.test(spanId)) safe.spanId = spanId;
    output.push(safe);
  }
  return output;
}
