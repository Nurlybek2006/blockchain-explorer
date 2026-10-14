import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts/browser';
import { describe, expect, it } from 'vitest';
import { connectionDisplay, networkDisplay, traceMessage, verificationDisplay } from './status-display';
import { affectsAddress, affectsExplorerOverview, affectsToken } from './resource-events';
describe('Honest status display', () => {
  it('shows live only for a connected socket', () => { expect(connectionDisplay('live').tone).toBe('success'); expect(connectionDisplay('connecting').label).toBe('Connecting…'); expect(connectionDisplay('offline').tone).toBe('warning'); expect(connectionDisplay('reconnecting').label).toBe('Reconnecting…'); });
  it('distinguishes verified, pending and failure states', () => { expect(verificationDisplay('verified').tone).toBe('success'); expect(verificationDisplay('pending').tone).toBe('warning'); expect(verificationDisplay('failed').tone).toBe('danger'); expect(verificationDisplay('unverified').label).toBe('Unverified'); });
  it('explains unsupported and queued trace outcomes', () => { expect(traceMessage('not-supported')).toContain('does not support'); expect(traceMessage('pending')).toContain('background'); expect(traceMessage('failed')).toContain('remain available'); });
  it('distinguishes syncing and degraded network status', () => { expect(networkDisplay('synced').tone).toBe('success'); expect(networkDisplay('syncing').label).toBe('Syncing'); expect(networkDisplay('degraded').tone).toBe('danger'); });
});
describe('Targeted resource updates', () => {
  const address = `0x${'ab'.repeat(20)}`, token = `0x${'cd'.repeat(20)}`;
  const transfer: RealtimeExplorerEvent = { id: '1', occurredAt: '2026-10-14T10:00:00.000Z', type: 'token.transfer.indexed', payload: { chainId: 11155111, networkName: 'Sepolia', blockNumber: '1', transactionHash: `0x${'aa'.repeat(32)}`, transactionIndex: 0, logIndex: 0, tokenAddress: token, fromAddress: address, toAddress: `0x${'ef'.repeat(20)}`, amountRaw: '100000000000000000000000' } };
  it('refreshes only matching transfer addresses and token contracts', () => { expect(affectsAddress(transfer, address.toUpperCase())).toBe(true); expect(affectsToken(transfer, token)).toBe(true); expect(affectsAddress(transfer, token)).toBe(false); expect(affectsToken(transfer, address)).toBe(false); expect(affectsExplorerOverview(transfer)).toBe(false); });
  it('invalidates explorer resources after a reorganization', () => { const event: RealtimeExplorerEvent = { id: '2', occurredAt: '2026-10-14T10:00:00.000Z', type: 'chain.reorganized', payload: { chainId: 11155111, networkName: 'Sepolia', detectedAtBlock: '20', commonAncestorBlock: '18', commonAncestorHash: null } }; expect(affectsAddress(event, address)).toBe(true); expect(affectsToken(event, token)).toBe(true); expect(affectsExplorerOverview(event)).toBe(true); });
});
