import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts/browser';
import { describe, expect, it } from 'vitest';
import { connectionDisplay, networkDisplay, traceMessage, traceStatusLabel, verificationDisplay } from './status-display';
import { affectsAddress, affectsExplorerOverview, affectsToken } from './resource-events';
describe('Honest status display', () => {
  it('shows live only for a connected socket', () => { expect(connectionDisplay('live', 'en').tone).toBe('success'); expect(connectionDisplay('connecting', 'en').label).toBe('Connecting…'); expect(connectionDisplay('offline', 'en').tone).toBe('warning'); expect(connectionDisplay('reconnecting', 'en').label).toBe('Reconnecting…'); });
  it('distinguishes verified, pending and failure states', () => { expect(verificationDisplay('verified', 'en').tone).toBe('success'); expect(verificationDisplay('pending', 'en').tone).toBe('warning'); expect(verificationDisplay('failed', 'en').tone).toBe('danger'); expect(verificationDisplay('unverified', 'en').label).toBe('Unverified'); });
  it('explains unsupported and queued trace outcomes', () => { expect(traceMessage('not-supported', 'en')).toContain('does not support'); expect(traceMessage('pending', 'en')).toContain('background'); expect(traceMessage('failed', 'en')).toContain('remain available'); });
  it('distinguishes syncing and degraded network status', () => { expect(networkDisplay('synced', 'en').tone).toBe('success'); expect(networkDisplay('syncing', 'en').label).toBe('Syncing'); expect(networkDisplay('degraded', 'en').tone).toBe('danger'); });
});
describe('Localized status display', () => {
  it('defaults to Kazakh and keeps technical status meaning', () => { expect(connectionDisplay('live').label).toBe('Тікелей'); expect(connectionDisplay('reconnecting').label).toBe('Қайта қосылуда…'); expect(verificationDisplay('verified').label).toBe('Расталған'); expect(networkDisplay('syncing').label).toBe('Синхрондалуда'); expect(traceStatusLabel('queued')).toBe('Трассировка кезекте'); });
  it('maps every trace outcome in both languages', () => { for (const status of ['not_requested', 'queued', 'processing', 'completed', 'unsupported', 'failed'] as const) { expect(traceStatusLabel(status, 'kk')).not.toBe(traceStatusLabel(status, 'en')); } expect(traceMessage('not-supported', 'kk')).toContain('RPC'); });
});
describe('Targeted resource updates', () => {
  const address = `0x${'ab'.repeat(20)}`, token = `0x${'cd'.repeat(20)}`;
  const transfer: RealtimeExplorerEvent = { id: '1', occurredAt: '2026-10-14T10:00:00.000Z', type: 'token.transfer.indexed', payload: { chainId: 11155111, networkName: 'Sepolia', blockNumber: '1', transactionHash: `0x${'aa'.repeat(32)}`, transactionIndex: 0, logIndex: 0, tokenAddress: token, fromAddress: address, toAddress: `0x${'ef'.repeat(20)}`, amountRaw: '100000000000000000000000' } };
  it('refreshes only matching transfer addresses and token contracts', () => { expect(affectsAddress(transfer, address.toUpperCase())).toBe(true); expect(affectsToken(transfer, token)).toBe(true); expect(affectsAddress(transfer, token)).toBe(false); expect(affectsToken(transfer, address)).toBe(false); expect(affectsExplorerOverview(transfer)).toBe(false); });
  it('invalidates explorer resources after a reorganization', () => { const event: RealtimeExplorerEvent = { id: '2', occurredAt: '2026-10-14T10:00:00.000Z', type: 'chain.reorganized', payload: { chainId: 11155111, networkName: 'Sepolia', detectedAtBlock: '20', commonAncestorBlock: '18', commonAncestorHash: null } }; expect(affectsAddress(event, address)).toBe(true); expect(affectsToken(event, token)).toBe(true); expect(affectsExplorerOverview(event)).toBe(true); });
});
