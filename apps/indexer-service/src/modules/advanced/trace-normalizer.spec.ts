import { describe, expect, it } from 'vitest';
import {
  JsonRpcError,
  RpcHttpError,
} from '@blockchain-explorer/blockchain-client';
import {
  normalizeCallTrace,
  isUnsupportedTraceError,
} from './trace-normalizer.js';
import { ADDRESS, OTHER_ADDRESS, HASH } from './advanced.fixtures.js';

const call = {
  type: 'CALL',
  from: ADDRESS,
  to: OTHER_ADDRESS,
  value: '0x1',
  gas: '0xffff',
  gasUsed: '0x1234',
  input: '0x12345678',
  output: '0x',
};
describe('callTracer normalization and Ethereum internal-call semantics', () => {
  it('flattens pre-order traceAddress paths and preserves quantities beyond Number precision', () => {
    const rows = normalizeCallTrace(
      {
        ...call,
        value: '0x20000000000001',
        calls: [
          { ...call, calls: [{ ...call, type: 'STATICCALL' }, call] },
          { ...call, calls: [call] },
        ],
      },
      HASH,
      9007199254740993n,
    );
    expect(rows.map((row) => row.traceAddress)).toEqual([
      'root',
      '0',
      '0.0',
      '0.1',
      '1',
      '1.0',
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 2, 1, 2]);
    expect(rows[0]).toMatchObject({
      value: '9007199254740993',
      blockNumber: '9007199254740993',
      gasUsed: '4660',
      valueBearing: false,
    });
  });
  it('only labels actual successful value movements as value-bearing internal calls', () => {
    const rows = normalizeCallTrace(
      {
        ...call,
        calls: [
          'CALL',
          'DELEGATECALL',
          'STATICCALL',
          'CALLCODE',
          'CREATE',
          'CREATE2',
          'SELFDESTRUCT',
        ].map((type) => ({ ...call, type })),
      },
      HASH,
      1n,
    );
    expect(
      rows.filter((row) => row.valueBearing).map((row) => row.type),
    ).toEqual(['CALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT']);
  });
  it('excludes value movement when an ancestor reverted, including root failure', () => {
    const rootFailed = normalizeCallTrace(
      { ...call, error: 'execution reverted', calls: [call] },
      HASH,
      1n,
    );
    expect(rootFailed.every((row) => !row.valueBearing)).toBe(true);
    const childFailed = normalizeCallTrace(
      {
        ...call,
        calls: [{ ...call, error: 'execution reverted', calls: [call] }, call],
      },
      HASH,
      1n,
    );
    expect(
      childFailed
        .filter((row) => row.valueBearing)
        .map((row) => row.traceAddress),
    ).toEqual(['1']);
  });
  it('does not pretend zero or missing values are internal transfers', () => {
    const rows = normalizeCallTrace(
      { ...call, calls: [{ ...call, value: '0x0' }, { type: 'CALL' }] },
      HASH,
      1n,
    );
    expect(rows.every((row) => !row.valueBearing)).toBe(true);
  });
  it.each([
    null,
    [],
    { type: 'structLogs' },
    { ...call, value: 'nothex' },
    { ...call, from: 'bad' },
    { ...call, input: '0x1' },
    { ...call, calls: 'bad' },
  ])('rejects invalid trace shape %j', (payload) => {
    expect(() => normalizeCallTrace(payload, HASH, 1n)).toThrow();
  });
  it('bounds hostile deep trees without recursive stack overflow', () => {
    let node: unknown = call;
    for (let index = 0; index < 100; index += 1)
      node = { ...call, calls: [node] };
    expect(() => normalizeCallTrace(node, HASH, 1n)).toThrow(
      'Trace tree exceeds supported limits',
    );
  });
  it('maps missing debug methods and unsupported tracers separately from transient failures', () => {
    expect(
      isUnsupportedTraceError(new JsonRpcError(-32601, 'Method not found')),
    ).toBe(true);
    expect(
      isUnsupportedTraceError(
        new JsonRpcError(-32602, 'Unknown tracer callTracer'),
      ),
    ).toBe(true);
    expect(
      isUnsupportedTraceError(
        new JsonRpcError(-32000, 'debug API not available'),
      ),
    ).toBe(true);
    expect(
      isUnsupportedTraceError(new JsonRpcError(-32005, 'rate limit exceeded')),
    ).toBe(false);
    expect(isUnsupportedTraceError(new RpcHttpError(429, 'rate limited'))).toBe(
      false,
    );
  });
});
