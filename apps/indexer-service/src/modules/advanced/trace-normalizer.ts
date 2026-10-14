import { JsonRpcError } from '@blockchain-explorer/blockchain-client';
import {
  isEthereumAddress,
  type TransactionTraceEntry,
} from '@blockchain-explorer/contracts';

const CALL_TYPES = new Set([
  'CALL',
  'CALLCODE',
  'DELEGATECALL',
  'STATICCALL',
  'CREATE',
  'CREATE2',
  'SELFDESTRUCT',
]);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function address(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isEthereumAddress(value)) throw new Error('Invalid trace address');
  return value.toLowerCase();
}
function quantity(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-fA-F]+$/.test(value) ||
    value.length > 68
  )
    throw new Error('Invalid trace quantity');
  const decimal = BigInt(value).toString();
  if (decimal.length > 78)
    throw new Error('Trace quantity exceeds storage precision');
  return decimal;
}
function bytes(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    value.length > 262146
  )
    throw new Error('Invalid trace byte data');
  return value.toLowerCase();
}
function errorText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 4096)
    throw new Error('Invalid trace error');
  return value;
}

export function isValueBearingInternalCall(
  entry: Pick<
    TransactionTraceEntry,
    'traceAddress' | 'type' | 'value' | 'error'
  >,
): boolean {
  return (
    entry.traceAddress !== 'root' &&
    entry.error === null &&
    ['CALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT'].includes(entry.type) &&
    entry.value !== null &&
    BigInt(entry.value) > 0n
  );
}

/** Pre-order flattening: root, 0, 0.0, 0.1, 1. Never recursively follows untrusted trees. */
export function normalizeCallTrace(
  payload: unknown,
  transactionHash: string,
  blockNumber: bigint,
): TransactionTraceEntry[] {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))
    throw new Error('Invalid trace transaction hash');
  const stack: Array<{
    node: unknown;
    path: string;
    depth: number;
    ancestorFailed: boolean;
  }> = [{ node: payload, path: 'root', depth: 0, ancestorFailed: false }];
  const traces: TransactionTraceEntry[] = [];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    if (
      current.depth > 32 ||
      current.path.length > 128 ||
      traces.length >= 10000 ||
      !record(current.node)
    )
      throw new Error('Trace tree exceeds supported limits');
    const node = current.node;
    if (
      typeof node.type !== 'string' ||
      !CALL_TYPES.has(node.type.toUpperCase())
    )
      throw new Error('Unsupported call tracer result');
    const type = node.type.toUpperCase();
    const error = errorText(node.error ?? node.revertReason);
    const trace: TransactionTraceEntry = {
      transactionHash: transactionHash.toLowerCase(),
      blockNumber: blockNumber.toString(),
      traceAddress: current.path,
      depth: current.depth,
      type,
      callType: ['CALL', 'CALLCODE', 'DELEGATECALL', 'STATICCALL'].includes(
        type,
      )
        ? type
        : null,
      fromAddress: address(node.from),
      toAddress: address(node.to),
      value: quantity(
        node.value ?? (type === 'SELFDESTRUCT' ? node.balance : undefined),
      ),
      gas: quantity(node.gas),
      gasUsed: quantity(node.gasUsed),
      input: bytes(node.input),
      output: bytes(node.output),
      error,
      valueBearing: false,
    };
    trace.valueBearing =
      !current.ancestorFailed && isValueBearingInternalCall(trace);
    traces.push(trace);
    if (node.calls !== undefined) {
      if (
        !Array.isArray(node.calls) ||
        node.calls.length > 10000 ||
        traces.length + stack.length + node.calls.length > 10000
      )
        throw new Error('Invalid trace children');
      for (let index = node.calls.length - 1; index >= 0; index -= 1) {
        stack.push({
          node: node.calls[index],
          path:
            current.path === 'root'
              ? String(index)
              : `${current.path}.${index}`,
          depth: current.depth + 1,
          ancestorFailed: current.ancestorFailed || error !== null,
        });
      }
    }
  }
  return traces;
}

export function isUnsupportedTraceError(error: unknown): boolean {
  if (!(error instanceof JsonRpcError)) return false;
  const message = error.message.toLowerCase();
  return (
    error.code === -32601 ||
    (error.code === -32602 && message.includes('tracer')) ||
    [
      'method not found',
      'not supported',
      'unsupported',
      'not available',
      'does not exist',
      'debug api',
      'unknown tracer',
      'tracing is disabled',
      'not whitelisted',
      'not allowed',
      'not permitted',
    ].some((phrase) => message.includes(phrase))
  );
}
