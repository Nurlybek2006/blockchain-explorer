import { describe, expect, it } from 'vitest';
import type { ContractDetailResponse, NetworkStatusResponse, PortfolioDetailResponse, TransactionTraceEntry, TransactionTraceResponse } from '@blockchain-explorer/contracts';
import * as gateway from '../../apps/api-gateway/src/modules/explorer/advanced-explorer.decoder.js';
import * as browser from '../../apps/web/src/lib/api/advanced-explorer.decoder.js';
import { decodePortfolioDetail as gatewayPortfolio } from '../../apps/api-gateway/src/modules/portfolio/portfolio-response.decoder.js';
import { decodePortfolioDetail as browserPortfolio } from '../../apps/web/src/lib/api/intelligence.decoder.js';
import { decodeAuth } from '../../apps/web/src/lib/api/auth.api.js';
import { createEventEnvelope, EVENT_TYPES } from '@blockchain-explorer/contracts';
import { mapRealtimeEvent } from '../../apps/api-gateway/src/modules/realtime/realtime-event.mapper.js';
import { decodeRealtimeEvent } from '../../apps/web/src/lib/realtime/realtime.decoder.js';
import { blockHash, contract, date, decimalAmount, hash, wallet } from '../helpers/provider-fixtures.js';

const verification: ContractDetailResponse = { address: contract, isContract: true, firstSeenBlock: '101', lastSeenBlock: '101', verification: {
  status: 'verified', verified: true, contractName: 'Fixture', compilerVersion: 'v0.8.24', optimizationUsed: false, optimizationRuns: 0,
  sourceCode: 'contract Fixture {}', abi: [], constructorArguments: '', verificationSource: 'etherscan', verifiedAt: date, lastCheckedAt: date,
} };
const trace: TransactionTraceEntry = { transactionHash: hash, blockNumber: '101', traceAddress: '0', depth: 1, type: 'CALL', callType: 'CALL',
  fromAddress: contract, toAddress: wallet, value: decimalAmount, gas: '100', gasUsed: '10', input: '0x', output: '0x', error: null, valueBearing: true };
const portfolio: PortfolioDetailResponse = { id: '00000000-0000-4000-8000-000000000001', name: 'Main', walletAddress: wallet, chainId: 11155111, isPrimary: true,
  createdAt: date, updatedAt: date, holdings: [{ assetKey: 'native:eth', assetType: 'native', tokenAddress: null, symbol: 'ETH', name: 'Ethereum', decimals: 18,
    balanceRaw: decimalAmount, balanceFormatted: '900719925.4740993', lastUpdatedBlock: '101', updatedAt: date }] };

describe('producer contract -> Gateway allowlist -> browser runtime decoder', () => {
  it('contract/source/ABI response remains compatible across service and browser boundaries', () => {
    expect(browser.decodeContract(gateway.decodeContract(verification))).toEqual(verification);
  });
  it.each(['unverified', 'pending', 'unsupported', 'failed'] as const)('verification %s state never fabricates verified data', (status) => {
    const value: ContractDetailResponse = { ...verification, verification: { ...verification.verification, status, verified: false, sourceCode: null, abi: null, verifiedAt: null } };
    expect(browser.decodeContract(gateway.decodeContract(value))).toEqual(value);
  });
  it('trace retains decimal precision and exact internal call structure', () => {
    const root: TransactionTraceEntry = { ...trace, traceAddress: 'root', depth: 0, fromAddress: wallet, toAddress: contract, valueBearing: false };
    const value: TransactionTraceResponse = { transactionHash: hash, available: true, status: 'completed', reason: null, traces: [root, trace], internalCalls: [trace], updatedAt: date };
    expect(browser.decodeTraces(gateway.decodeTraces(value))).toEqual(value);
  });
  it.each(['unsupported', 'failed', 'queued'] as const)('trace %s contract represents unavailable states consistently', (status) => {
    const value: TransactionTraceResponse = { transactionHash: hash, available: false, status, reason: status === 'unsupported' ? 'not-supported' : status === 'failed' ? 'failed' : 'pending', traces: [], internalCalls: [], updatedAt: date };
    expect(browser.decodeTraces(gateway.decodeTraces(value))).toEqual(value);
  });
  it('rejects numeric quantities at both trace boundaries', () => {
    for (const decode of [gateway.decodeTraceEntry, browser.decodeTraceEntry]) expect(() => decode({ ...trace, value: 9007199254740992 })).toThrow();
  });
  it('rejects transaction hash drift and impossible trace path/depth', () => {
    for (const decode of [gateway.decodeTraceEntry, browser.decodeTraceEntry]) expect(() => decode({ ...trace, depth: 2 })).toThrow();
    const value = { transactionHash: blockHash, available: true, status: 'completed', reason: null, traces: [trace], internalCalls: [], updatedAt: date };
    for (const decode of [gateway.decodeTraces, browser.decodeTraces]) expect(() => decode(value)).toThrow();
  });
  it('portfolio detail is stable, strips private identity fields and preserves raw balances', () => {
    const decoded = browserPortfolio(gatewayPortfolio({ ...portfolio, userId: 'private-owner', passwordHash: 'never-forward' }));
    expect(decoded).toEqual(portfolio); expect(decoded.holdings[0]?.balanceRaw).toBe(decimalAmount);
    expect(decoded).not.toHaveProperty('userId');
  });
  it('portfolio drift in UUID, wallet, boolean or raw balance is rejected at the Gateway', () => {
    for (const patch of [{ id: 'bad' }, { walletAddress: hash }, { isPrimary: 'true' }, { holdings: [{ ...portfolio.holdings[0], balanceRaw: 10 }] }]) expect(() => gatewayPortfolio({ ...portfolio, ...patch })).toThrow();
  });
  it('network unknown values stay null and precise heights are not numbers', () => {
    const value: NetworkStatusResponse = { chainId: 11155111, networkName: 'ethereum-sepolia', rpcLatestBlock: '9007199254740993', indexedBlock: null, lag: null, status: 'starting', updatedAt: date };
    expect(browser.decodeNetworkStatus(gateway.decodeNetworkStatus(value))).toEqual(value);
    for (const decode of [gateway.decodeNetworkStatus, browser.decodeNetworkStatus]) expect(() => decode({ ...value, indexedBlock: 9007199254740992 })).toThrow();
  });
  it('search destinations are derived from known public resource types', () => {
    const value = { type: 'contract', value: contract, destination: `/contract/${contract}` };
    expect(browser.decodeSearch(gateway.decodeSearch(value))).toEqual(value);
    for (const decode of [gateway.decodeSearch, browser.decodeSearch]) expect(() => decode({ ...value, destination: 'https://attacker.example' })).toThrow();
  });
  it('outbox trace metadata is omitted from actual Gateway -> browser realtime contract', () => {
    const event = createEventEnvelope(EVENT_TYPES.BLOCK_INDEXED, 'indexer-service', { chainId: 11155111, networkName: 'ethereum-sepolia', blockNumber: '101', blockHash, parentHash: blockHash, timestamp: date, transactionCount: 1, logCount: 1, tokenTransferCount: 1 });
    const publicEvent = mapRealtimeEvent({ ...event, metadata: { traceContext: { traceparent: '00-private-private-01', 'x-request-id': 'private' } } }, 11155111);
    expect(publicEvent).not.toBeNull();
    expect(decodeRealtimeEvent(publicEvent)).toEqual(publicEvent);
    expect(publicEvent).not.toHaveProperty('metadata'); expect(publicEvent).not.toHaveProperty('producer');
  });
  it('auth browser decoder validates issued token/user contract without accepting missing fields', () => {
    const value = { user: { id: portfolio.id, email: 'tc@example.test', displayName: null, role: 'user', createdAt: date, emailVerifiedAt: null, lastLoginAt: null }, accessToken: 'issued-access', refreshToken: 'issued-refresh', accessTokenExpiresIn: 900 };
    expect(decodeAuth(value).accessToken).toBe('issued-access'); expect(() => decodeAuth({ ...value, accessTokenExpiresIn: '900' })).toThrow();
  });
});
