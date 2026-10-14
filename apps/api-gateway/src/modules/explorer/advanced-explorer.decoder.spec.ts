import { describe, expect, it } from 'vitest';
import { decodeContract, decodeNetworkStatus, decodeSearch, decodeTraces } from './advanced-explorer.decoder.js';
const hash = `0x${'a'.repeat(64)}`;
const address = `0x${'b'.repeat(40)}`;
const date = '2026-10-14T00:00:00.000Z';
const contract = { address, isContract: true, firstSeenBlock: '9007199254740993', lastSeenBlock: '9007199254740994', verification: { status: 'verified', verified: true, contractName: 'Token', compilerVersion: 'v0.8.20', optimizationUsed: true, optimizationRuns: 200, sourceCode: 'contract Token {}', abi: [{ type: 'function', name: 'transfer', inputs: [] }], constructorArguments: '', verificationSource: 'etherscan', verifiedAt: date, lastCheckedAt: date } };
const root = { transactionHash: hash, blockNumber: '42', traceAddress: 'root', depth: 0, type: 'CALL', callType: 'CALL', fromAddress: address, toAddress: address, value: '0', gas: '999999999999999999999999', gasUsed: '1200', input: '0x', output: '0x', error: null, valueBearing: false };
const child = { ...root, traceAddress: '0', depth: 1, value: '1', valueBearing: true };

describe('Advanced Explorer public response validation', () => {
  it('preserves exact quantities and removes internal/private contract fields', () => {
    const result = decodeContract({ ...contract, userId: 'private', internalToken: 'secret', verification: { ...contract.verification, secret: 'hidden' } });
    expect(result).toEqual(contract);
    expect(result.firstSeenBlock).toBe('9007199254740993');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('rejects inconsistent verification status and unexpected non-contract response', () => {
    expect(() => decodeContract({ ...contract, verification: { ...contract.verification, verified: false } })).toThrow('invalid response');
    expect(() => decodeContract({ ...contract, isContract: false })).toThrow('invalid response');
  });
  it('rejects malformed ABI and bounds deeply nested JSON', () => {
    expect(() => decodeContract({ ...contract, verification: { ...contract.verification, abi: '{}' } })).toThrow('invalid response');
    let nested: unknown = 'item'; for (let i = 0; i < 40; i++) nested = [nested];
    expect(() => decodeContract({ ...contract, verification: { ...contract.verification, abi: [nested] } })).toThrow('invalid response');
  });
  it('validates normalized call trees and exact internal call classification', () => {
    const response = { transactionHash: hash, available: true, status: 'completed', reason: null, traces: [root, child], internalCalls: [child], updatedAt: date };
    expect(decodeTraces(response)).toEqual(response);
    expect(() => decodeTraces({ ...response, internalCalls: [root] })).toThrow('invalid response');
    expect(() => decodeTraces({ ...response, traces: [root, { ...child, depth: 2 }] })).toThrow('invalid response');
  });
  it('suppresses apparent value transfers inside a reverted ancestor', () => {
    const response = { transactionHash: hash, available: true, status: 'completed', reason: null, traces: [{ ...root, error: 'revert' }, { ...child, valueBearing: false }], internalCalls: [], updatedAt: date };
    expect(decodeTraces(response).internalCalls).toEqual([]);
  });
  it('accepts supported unavailable statuses without inventing trace data', () => {
    expect(decodeTraces({ transactionHash: hash, available: false, status: 'unsupported', reason: 'not-supported', traces: [], internalCalls: [], updatedAt: date }).available).toBe(false);
    expect(() => decodeTraces({ transactionHash: hash, available: false, status: 'unsupported', reason: 'not-supported', traces: [root], internalCalls: [], updatedAt: date })).toThrow('invalid response');
  });
  it('rejects duplicate paths and mixed transaction identities', () => {
    const response = { transactionHash: hash, available: true, status: 'completed', reason: null, traces: [root, root], internalCalls: [], updatedAt: date };
    expect(() => decodeTraces(response)).toThrow('invalid response');
    expect(() => decodeTraces({ ...response, traces: [{ ...root, transactionHash: `0x${'c'.repeat(64)}` }] })).toThrow('invalid response');
  });
  it.each([['block', '12345678901234567890', '/blocks/12345678901234567890'], ['transaction', hash, `/tx/${hash}`], ['address', address, `/address/${address}`], ['contract', address, `/contract/${address}`], ['token', address, `/token/${address}`]])('accepts only the exact public %s destination', (type, value, destination) => {
    expect(decodeSearch({ type, value, destination, internalToken: 'secret' })).toEqual({ type, value, destination });
    expect(() => decodeSearch({ type, value, destination: 'https://evil.test' })).toThrow('invalid response');
  });
  it('validates lag with bigint precision and honest unknown status values', () => {
    const status = { chainId: 11155111, networkName: 'sepolia', rpcLatestBlock: '9007199254740999', indexedBlock: '9007199254740993', lag: '6', status: 'syncing', updatedAt: date };
    expect(decodeNetworkStatus(status)).toEqual(status);
    expect(() => decodeNetworkStatus({ ...status, lag: '5' })).toThrow('invalid response');
    expect(decodeNetworkStatus({ ...status, rpcLatestBlock: null, lag: null, status: 'degraded' }).lag).toBeNull();
    expect(decodeNetworkStatus({ ...status, rpcLatestBlock: '1', indexedBlock: '2', lag: null, status: 'degraded' }).lag).toBeNull();
  });
});
