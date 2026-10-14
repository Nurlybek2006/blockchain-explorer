import type { ContractDetailResponse, ContractVerificationStatus, ExplorerSearchResponse, NetworkStatusResponse, TransactionTraceEntry, TransactionTraceResponse, TransactionTraceStatus } from '@blockchain-explorer/contracts/browser';
import { isEthereumAddress } from '@blockchain-explorer/contracts/browser';
import { invalidResponse, readArray, readBoolean, readInteger, readNullableString, readNullableTimestamp, readRecord, readString, readTimestamp } from './fields';

export function readQuantity(value: unknown): string { const text = readString(value); return /^\d+$/.test(text) ? text : invalidResponse('quantity'); }
export function readHash(value: unknown): string { const text = readString(value); return /^0x[\da-f]{64}$/i.test(text) ? text : invalidResponse('hash'); }
export function readAddress(value: unknown): string { return isEthereumAddress(value) ? value : invalidResponse('address'); }
const nullableQuantity = (value: unknown) => value === null ? null : readQuantity(value);
function verificationStatus(value: unknown): ContractVerificationStatus { if (value === 'verified' || value === 'unverified' || value === 'pending' || value === 'unsupported' || value === 'failed') return value; return invalidResponse('verification status'); }
function traceStatus(value: unknown): TransactionTraceStatus { if (value === 'not_requested' || value === 'queued' || value === 'processing' || value === 'completed' || value === 'unsupported' || value === 'failed') return value; return invalidResponse('trace status'); }
export function decodeContract(value: unknown): ContractDetailResponse {
  const b = readRecord(value), v = readRecord(b.verification), status = verificationStatus(v.status), verified = readBoolean(v.verified);
  if (b.isContract !== true || verified !== (status === 'verified')) return invalidResponse('contract status');
  const abi = v.abi === null ? null : readArray(v.abi, item => item);
  const sourceCode = readNullableString(v.sourceCode);
  if (verified && (!sourceCode || abi === null)) return invalidResponse('verified source');
  return { address: readAddress(b.address), isContract: true, firstSeenBlock: nullableQuantity(b.firstSeenBlock), lastSeenBlock: nullableQuantity(b.lastSeenBlock), verification: {
    status, verified, contractName: readNullableString(v.contractName), compilerVersion: readNullableString(v.compilerVersion), optimizationUsed: v.optimizationUsed === null ? null : readBoolean(v.optimizationUsed), optimizationRuns: v.optimizationRuns === null ? null : readInteger(v.optimizationRuns), sourceCode, abi, constructorArguments: readNullableString(v.constructorArguments), verificationSource: readString(v.verificationSource), verifiedAt: readNullableTimestamp(v.verifiedAt), lastCheckedAt: readNullableTimestamp(v.lastCheckedAt),
  } };
}
export function decodeTraceEntry(value: unknown): TransactionTraceEntry {
  const b = readRecord(value), traceAddress = readString(b.traceAddress), depth = readInteger(b.depth);
  if (traceAddress.length > 4096 || !/^(root|\d+(?:\.\d+)*)$/.test(traceAddress) || depth !== (traceAddress === 'root' ? 0 : traceAddress.split('.').length)) return invalidResponse('trace path');
  return { transactionHash: readHash(b.transactionHash), blockNumber: readQuantity(b.blockNumber), traceAddress, depth, type: readString(b.type), callType: readNullableString(b.callType), fromAddress: b.fromAddress === null ? null : readAddress(b.fromAddress), toAddress: b.toAddress === null ? null : readAddress(b.toAddress), value: nullableQuantity(b.value), gas: nullableQuantity(b.gas), gasUsed: nullableQuantity(b.gasUsed), input: readNullableString(b.input), output: readNullableString(b.output), error: readNullableString(b.error), valueBearing: readBoolean(b.valueBearing) };
}
export function decodeTraces(value: unknown): TransactionTraceResponse {
  const b = readRecord(value), transactionHash = readHash(b.transactionHash), available = readBoolean(b.available), status = traceStatus(b.status), reason = b.reason;
  if (reason !== null && reason !== 'not-supported' && reason !== 'not-indexed' && reason !== 'pending' && reason !== 'failed' && reason !== 'not-requested') return invalidResponse('trace reason');
  const traces = readArray(b.traces, decodeTraceEntry), internalCalls = readArray(b.internalCalls, decodeTraceEntry);
  if (available !== (status === 'completed') || (available && reason !== null) || traces.length > 10000 || traces.some(trace => trace.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) || internalCalls.some(trace => !trace.valueBearing || trace.traceAddress === 'root')) return invalidResponse('trace response');
  return { transactionHash, available, status, reason, traces, internalCalls, updatedAt: readNullableTimestamp(b.updatedAt) };
}
export function searchDestination(type: ExplorerSearchResponse['type'], value: string): string {
  if (type === 'block') return `/blocks/${BigInt(readQuantity(value)).toString()}`;
  if (type === 'transaction') return `/tx/${readHash(value).toLowerCase()}`;
  return `/${type === 'address' ? 'address' : type === 'contract' ? 'contract' : 'token'}/${readAddress(value).toLowerCase()}`;
}
export function decodeSearch(value: unknown): ExplorerSearchResponse {
  const b = readRecord(value), type = b.type;
  if (type !== 'block' && type !== 'transaction' && type !== 'address' && type !== 'contract' && type !== 'token') return invalidResponse('search type');
  const text = readString(b.value), destination = searchDestination(type, text);
  if (b.destination !== destination) return invalidResponse('search destination');
  return { type, value: text, destination };
}
export function decodeNetworkStatus(value: unknown): NetworkStatusResponse {
  const b = readRecord(value), status = b.status;
  if (status !== 'starting' && status !== 'syncing' && status !== 'synced' && status !== 'degraded' && status !== 'stopped') return invalidResponse('network status');
  return { chainId: readInteger(b.chainId), networkName: readString(b.networkName), rpcLatestBlock: nullableQuantity(b.rpcLatestBlock), indexedBlock: nullableQuantity(b.indexedBlock), lag: nullableQuantity(b.lag), status, updatedAt: readTimestamp(b.updatedAt) };
}
