import type { Attributes } from '@opentelemetry/api';
import { sanitizeText } from './sanitize.js';

export type TelemetryAttributes = Readonly<Record<string, string | number | boolean | undefined>>;
const prohibited = /authorization|cookie|password|secret|token|api.?key|credential|body|payload|db\.statement|db\.query\.text|url\.full|http\.url|url\.path|url\.query/i;

export function safeAttributes(input: TelemetryAttributes): Attributes {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(input).slice(0, 40)) {
    if (value === undefined || prohibited.test(key)) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    result[key] = typeof value === 'string' ? sanitizeText(value).slice(0, 512) : value;
  }
  return result;
}

/** Auto instrumentation attributes pass through the same privacy boundary. */
export function isSensitiveAttribute(key: string): boolean { return prohibited.test(key) || /db\.(?:connection_string|user)|url\.username|http\.(?:request|response)\.header|db\.redis\.args/i.test(key); }
