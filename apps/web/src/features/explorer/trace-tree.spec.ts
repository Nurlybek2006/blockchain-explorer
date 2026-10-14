import type { TransactionTraceEntry } from '@blockchain-explorer/contracts/browser';
import { describe, expect, it } from 'vitest';
import { methodSelector, prepareTraceRows } from './trace-tree';
function entry(traceAddress: string): TransactionTraceEntry { return { transactionHash: `0x${'aa'.repeat(32)}`, blockNumber: '1', traceAddress, depth: traceAddress === 'root' ? 0 : traceAddress.split('.').length, type: 'CALL', callType: 'CALL', fromAddress: null, toAddress: null, value: '0', gas: null, gasUsed: null, input: null, output: null, error: null, valueBearing: false }; }
describe('Flat trace tree', () => {
  it('orders sibling indexes numerically and parents before descendants', () => { expect(prepareTraceRows(['10', '0.10', '1', 'root', '0.2', '0'].map(entry)).rows.map(row => row.trace.traceAddress)).toEqual(['root', '0', '0.2', '0.10', '1', '10']); });
  it('preserves root and parent paths without recursive construction', () => { expect(prepareTraceRows(['root', '0', '0.2'].map(entry)).rows.map(row => row.parent)).toEqual([null, 'root', '0']); });
  it('deduplicates trace paths', () => { expect(prepareTraceRows([entry('root'), entry('root')]).rows).toHaveLength(1); });
  it('bounds visual depth while preserving actual depth', () => { const path = Array(500).fill('0').join('.'); const row = prepareTraceRows([entry(path)]).rows[0]; expect(row.visualDepth).toBe(12); expect(row.trace.depth).toBe(500); });
  it('limits rendered data while reporting omitted calls', () => { const result = prepareTraceRows(Array.from({ length: 10 }, (_, i) => entry(String(i))), 3); expect(result.rows).toHaveLength(3); expect(result.omitted).toBe(7); });
  it('handles huge sibling indexes without numeric precision loss', () => { expect(prepareTraceRows([entry('9007199254740993'), entry('9007199254740992')]).rows[0].trace.traceAddress).toBe('9007199254740992'); });
  it('returns exact four-byte selectors without inventing method names', () => { expect(methodSelector('0xA9059CBB' + '00'.repeat(32))).toBe('0xa9059cbb'); });
  it.each(['0x', '0x1234', '0xa9059cbb0', 'not-hex'])('has no selector for %s', input => { expect(methodSelector(input)).toBeNull(); });
});
