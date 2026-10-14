import { BadGatewayException } from '@nestjs/common';
import type { ContractDetailResponse, ContractVerificationStatus, TransactionTraceEntry, TransactionTraceResponse, TransactionTraceStatus, ExplorerSearchResponse, NetworkStatusResponse, ExplorerBlockDetailResponse, ExplorerTransactionResponse } from '@blockchain-explorer/contracts';

function invalid(): never { throw new BadGatewayException('Indexer service returned an invalid response'); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return invalid();
  return value;
}
function text(value: unknown, max = 2_000): string { if (typeof value !== 'string' || value.length > max) return invalid(); return value; }
function nullableText(value: unknown, max = 2_000): string | null { return value === null ? null : text(value, max); }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function int(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid(); return value;
}
function uint(value: unknown): string { const result = text(value, 78); if (!/^\d+$/.test(result)) return invalid(); return result; }
function nullableUint(value: unknown): string | null { return value === null ? null : uint(value); }
function address(value: unknown): string { const result = text(value, 42); if (!/^0x[0-9a-fA-F]{40}$/.test(result)) return invalid(); return result.toLowerCase(); }
function nullableAddress(value: unknown): string | null { return value === null ? null : address(value); }
function hash(value: unknown): string { const result = text(value, 66); if (!/^0x[0-9a-fA-F]{64}$/.test(result)) return invalid(); return result.toLowerCase(); }
function nullableHash(value: unknown): string | null { return value === null ? null : hash(value); }
function date(value: unknown): string { const result = text(value, 50); if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) return invalid(); return result; }
function nullableDate(value: unknown): string | null { return value === null ? null : date(value); }
function hex(value: unknown): string { const result = text(value, 262_146); if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) return invalid(); return result; }
function nullableHex(value: unknown): string | null { return value === null ? null : hex(value); }
function list<T>(value: unknown, decode: (entry: unknown) => T, max = 10_000): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid(); return value.map((item: unknown) => decode(item));
}
function verificationStatus(value: unknown): ContractVerificationStatus {
  if (value === 'verified' || value === 'unverified' || value === 'pending' || value === 'unsupported' || value === 'failed') return value;
  return invalid();
}
function traceStatus(value: unknown): TransactionTraceStatus {
  if (value === 'not_requested' || value === 'queued' || value === 'processing' || value === 'completed' || value === 'unsupported' || value === 'failed') return value;
  return invalid();
}

function abi(value: unknown): unknown[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 10_000 || JSON.stringify(value).length > 1024 * 1024) return invalid();
  // ABI is public JSON, but recursion/object keys are bounded before forwarding it.
  const pending: { value: unknown; depth: number }[] = value.map((item: unknown) => ({ value: item, depth: 0 }));
  let nodes = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item || item.depth > 32 || ++nodes > 30_000) return invalid();
    if (item.value === null || typeof item.value === 'string' || typeof item.value === 'boolean') continue;
    if (typeof item.value === 'number' && Number.isFinite(item.value)) continue;
    if (Array.isArray(item.value)) { pending.push(...item.value.map((entry: unknown) => ({ value: entry, depth: item.depth + 1 }))); continue; }
    const obj = record(item.value);
    if (Object.keys(obj).some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) return invalid();
    pending.push(...Object.values(obj).map((entry) => ({ value: entry, depth: item.depth + 1 })));
  }
  return structuredClone(value);
}

export function decodeContract(value: unknown): ContractDetailResponse {
  const obj = record(value); const v = record(obj.verification);
  if (obj.isContract !== true) return invalid();
  const status = verificationStatus(v.status); const verified = boolean(v.verified);
  if (verified !== (status === 'verified')) return invalid();
  return { address: address(obj.address), isContract: true, firstSeenBlock: nullableUint(obj.firstSeenBlock), lastSeenBlock: nullableUint(obj.lastSeenBlock), verification: {
    status, verified, contractName: nullableText(v.contractName), compilerVersion: nullableText(v.compilerVersion),
    optimizationUsed: v.optimizationUsed === null ? null : boolean(v.optimizationUsed), optimizationRuns: v.optimizationRuns === null ? null : int(v.optimizationRuns),
    sourceCode: nullableText(v.sourceCode, 4 * 1024 * 1024), abi: abi(v.abi), constructorArguments: nullableText(v.constructorArguments, 1024 * 1024),
    verificationSource: text(v.verificationSource, 100), verifiedAt: nullableDate(v.verifiedAt), lastCheckedAt: nullableDate(v.lastCheckedAt),
  } };
}

export function decodeTraceEntry(value: unknown): TransactionTraceEntry {
  const obj = record(value);
  const path = text(obj.traceAddress, 2_048);
  if (!/^(?:root|\d+(?:\.\d+)*)$/.test(path)) return invalid();
  const depth = int(obj.depth, 0, 512);
  if (depth !== (path === 'root' ? 0 : path.split('.').length)) return invalid();
  const type = text(obj.type, 30);
  if (!['CALL', 'CALLCODE', 'DELEGATECALL', 'STATICCALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT'].includes(type)) return invalid();
  const callType = nullableText(obj.callType, 30);
  if (callType !== null && !['CALL', 'CALLCODE', 'DELEGATECALL', 'STATICCALL'].includes(callType)) return invalid();
  const valueAmount = nullableUint(obj.value); const error = nullableText(obj.error, 4_096); const valueBearing = boolean(obj.valueBearing);
  const expectedValueBearing = path !== 'root' && error === null && ['CALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT'].includes(type) && valueAmount !== null && BigInt(valueAmount) > 0n;
  if (valueBearing && !expectedValueBearing) return invalid();
  return { transactionHash: hash(obj.transactionHash), blockNumber: uint(obj.blockNumber), traceAddress: path, depth, type, callType,
    fromAddress: nullableAddress(obj.fromAddress), toAddress: nullableAddress(obj.toAddress), value: valueAmount, gas: nullableUint(obj.gas), gasUsed: nullableUint(obj.gasUsed),
    input: nullableHex(obj.input), output: nullableHex(obj.output), error, valueBearing };
}

export function decodeTraces(value: unknown): TransactionTraceResponse {
  const obj = record(value); const status = traceStatus(obj.status); const available = boolean(obj.available);
  const reason = obj.reason;
  if (reason !== null && reason !== 'not-supported' && reason !== 'not-indexed' && reason !== 'pending' && reason !== 'failed' && reason !== 'not-requested') return invalid();
  const transactionHash = hash(obj.transactionHash); const traces = list(obj.traces, decodeTraceEntry); const internalCalls = list(obj.internalCalls, decodeTraceEntry);
  const byPath = new Map(traces.map((entry) => [entry.traceAddress, entry]));
  if (available !== (status === 'completed') || (available && (reason !== null || !byPath.has('root'))) || (!available && traces.length > 0)
    || traces.some((entry) => entry.transactionHash !== transactionHash) || byPath.size !== traces.length) return invalid();
  for (const entry of traces) {
    let parent = entry.traceAddress === 'root' ? null : entry.traceAddress.includes('.') ? entry.traceAddress.slice(0, entry.traceAddress.lastIndexOf('.')) : 'root';
    let ancestorFailed = false;
    while (parent !== null) {
      const node = byPath.get(parent); if (!node) return invalid();
      ancestorFailed ||= node.error !== null;
      parent = parent === 'root' ? null : parent.includes('.') ? parent.slice(0, parent.lastIndexOf('.')) : 'root';
    }
    const expected = !ancestorFailed && entry.traceAddress !== 'root' && entry.error === null && ['CALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT'].includes(entry.type) && entry.value !== null && BigInt(entry.value) > 0n;
    if (entry.valueBearing !== expected) return invalid();
  }
  if (internalCalls.some((entry) => !entry.valueBearing || JSON.stringify(byPath.get(entry.traceAddress)) !== JSON.stringify(entry))) return invalid();
  return { transactionHash, available, status, reason, traces, internalCalls, updatedAt: nullableDate(obj.updatedAt) };
}

export function decodeSearch(value: unknown): ExplorerSearchResponse {
  const obj = record(value); const type = obj.type;
  if (type !== 'block' && type !== 'transaction' && type !== 'address' && type !== 'contract' && type !== 'token') return invalid();
  const result = type === 'block' ? uint(obj.value) : type === 'transaction' ? hash(obj.value) : address(obj.value);
  const destination = text(obj.destination, 100);
  const expected = `${type === 'block' ? '/blocks' : type === 'transaction' ? '/tx' : `/${type}`}/${result}`;
  if (destination !== expected) return invalid();
  return { type, value: result, destination };
}

export function decodeNetworkStatus(value: unknown): NetworkStatusResponse {
  const obj = record(value); const status = obj.status;
  if (status !== 'starting' && status !== 'syncing' && status !== 'synced' && status !== 'degraded' && status !== 'stopped') return invalid();
  const rpcLatestBlock = nullableUint(obj.rpcLatestBlock), indexedBlock = nullableUint(obj.indexedBlock), lag = nullableUint(obj.lag);
  if (rpcLatestBlock !== null && indexedBlock !== null) {
    const delta = BigInt(rpcLatestBlock) - BigInt(indexedBlock);
    if (lag !== (delta < 0n ? null : delta.toString())) return invalid();
  }
  if ((rpcLatestBlock === null || indexedBlock === null) && lag !== null) return invalid();
  return { chainId: int(obj.chainId, 1), networkName: text(obj.networkName, 100), rpcLatestBlock, indexedBlock, lag, status, updatedAt: date(obj.updatedAt) };
}

function decodeTransaction(value: unknown): ExplorerTransactionResponse {
  const obj = record(value);
  return { hash: hash(obj.hash), blockNumber: uint(obj.blockNumber), blockHash: hash(obj.blockHash), transactionIndex: int(obj.transactionIndex), fromAddress: address(obj.fromAddress), toAddress: nullableAddress(obj.toAddress),
    nonce: uint(obj.nonce), value: uint(obj.value), gas: uint(obj.gas), gasPrice: nullableUint(obj.gasPrice), maxFeePerGas: nullableUint(obj.maxFeePerGas), maxPriorityFeePerGas: nullableUint(obj.maxPriorityFeePerGas),
    type: obj.type === null ? null : int(obj.type), input: hex(obj.input), indexedAt: date(obj.indexedAt) };
}

export function decodeBlockDetail(value: unknown): ExplorerBlockDetailResponse {
  const obj = record(value);
  return { number: uint(obj.number), hash: hash(obj.hash), parentHash: hash(obj.parentHash), miner: nullableAddress(obj.miner), timestamp: date(obj.timestamp), gasLimit: uint(obj.gasLimit), gasUsed: uint(obj.gasUsed),
    baseFeePerGas: nullableUint(obj.baseFeePerGas), size: obj.size === null ? null : int(obj.size), transactionCount: int(obj.transactionCount), transactionsRoot: nullableHash(obj.transactionsRoot), stateRoot: nullableHash(obj.stateRoot), receiptsRoot: nullableHash(obj.receiptsRoot), extraData: nullableHex(obj.extraData), indexedAt: date(obj.indexedAt), transactions: list(obj.transactions, decodeTransaction) };
}
