import type { TransactionTraceEntry } from '@blockchain-explorer/contracts/browser';
export interface TraceRow { trace: TransactionTraceEntry; parent: string | null; visualDepth: number; }
function comparePath(a: string, b: string): number {
  if (a === b) return 0;
  if (a === 'root') return -1;
  if (b === 'root') return 1;
  const left = a.split('.'), right = b.split('.');
  for (let i = 0; i < Math.min(left.length, right.length); i++) { const l = BigInt(left[i]), r = BigInt(right[i]); if (l < r) return -1; if (l > r) return 1; }
  return left.length - right.length;
}
export function prepareTraceRows(traces: readonly TransactionTraceEntry[], limit = 5000): { rows: TraceRow[]; omitted: number } {
  const unique = new Map<string, TransactionTraceEntry>();
  for (const trace of traces) if (!unique.has(trace.traceAddress)) unique.set(trace.traceAddress, trace);
  const sorted = [...unique.values()].sort((a, b) => comparePath(a.traceAddress, b.traceAddress));
  const boundedLimit = Math.min(5000, Math.max(1, limit));
  return { rows: sorted.slice(0, boundedLimit).map(trace => ({ trace, parent: trace.traceAddress === 'root' ? null : trace.traceAddress.includes('.') ? trace.traceAddress.slice(0, trace.traceAddress.lastIndexOf('.')) : 'root', visualDepth: Math.min(12, trace.depth) })), omitted: Math.max(0, sorted.length - boundedLimit) };
}
export function methodSelector(input: string): string | null { return /^0x[\da-f]{8}(?:[\da-f]{2})*$/i.test(input) ? input.slice(0, 10).toLowerCase() : null; }
