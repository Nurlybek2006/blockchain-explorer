const sensitiveKey = /authorization|cookie|password|passwd|secret|token|api.?key|database.?url|rabbitmq.?url|redis.?url|credential|body|payload/i;
const assignments = /(["']?(?:password|passwd|secret|token|api[-_]?key|authorization|cookie)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

/** Redacts known secret encodings even when a library embeds them in free text. */
export function sanitizeText(value: string): string {
  let text = value;
  // Libraries can echo a configured key without naming it in the error text.
  for (const [key, secret] of Object.entries(process.env).filter(([key]) => /SECRET|PASSWORD|TOKEN|API_?KEY/i.test(key)).slice(0, 128)) {
    if (secret && secret.length >= 4) text = text.replaceAll(secret, '[REDACTED]');
  }
  return text
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[REDACTED]')
    .replace(/\b(?:postgres(?:ql)?|amqps?|rediss?|https?):\/\/[^\s"'<>]+/gi, raw => {
      try {
        const url = new URL(raw);
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        // Provider paths can contain API keys, so only preserve the host.
        return `${url.protocol}//${url.host}/[REDACTED]`;
      } catch { return '[REDACTED]'; }
    })
    .replace(assignments, '$1[REDACTED]')
    .slice(0, 8_192);
}

export function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: sanitizeText(value.name), message: sanitizeText(value.message), stack: sanitizeText(value.stack ?? '') };
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitize(item, depth + 1, seen));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    result[key] = sensitiveKey.test(key) ? '[REDACTED]' : sanitize(item, depth + 1, seen);
  }
  return result;
}

export function sanitizedException(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: sanitizeText(error.name), message: sanitizeText(error.message), stack: sanitizeText(error.stack ?? '') };
  return { name: 'Error', message: sanitizeText(String(error)) };
}
