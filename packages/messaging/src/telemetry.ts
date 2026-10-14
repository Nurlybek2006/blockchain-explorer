/** Queue prefixes and event identifiers may be configured; metric dimensions stay finite. */
export function queueMetricName(name: string): string {
  if (name.endsWith('-verification')) return 'contract-verification';
  if (name.endsWith('-traces')) return 'transaction-traces';
  if (name === 'portfolio-jobs' || name.endsWith('-jobs')) return 'portfolio-jobs';
  return 'other';
}

const eventNames = new Set(['block.indexed.v1', 'token.transfer.indexed.v1', 'chain.reorganized.v1']);
export function eventMetricName(name: string): string { return eventNames.has(name) ? name : 'other'; }

export function cacheMetricNamespace(key: string): string {
  if (key.startsWith('price:') || key.startsWith('prices:')) return 'price';
  if (key.startsWith('portfolio:')) return 'portfolio';
  return 'explorer';
}

export function parseJobTraceContext(metadata: string | undefined): unknown {
  if (!metadata || metadata.length > 4_096) return undefined;
  try { const carrier: unknown = JSON.parse(metadata); return carrier; } catch { return undefined; }
}
