import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, type EventEnvelope } from '@blockchain-explorer/contracts';
import { mapRealtimeEvent, RealtimeDeduplicator } from './realtime-event.mapper.js';

const date = '2026-10-14T00:00:00.000Z';
const hash = `0x${'a'.repeat(64)}`;
const address = `0x${'B'.repeat(40)}`;
function event(type: string, payload: unknown): EventEnvelope { return { id: 'id-1', type, version: 1, occurredAt: date, producer: 'indexer', payload }; }
const block = { chainId: 11155111, networkName: 'sepolia', blockNumber: '90071992547409931234', blockHash: hash, parentHash: hash, timestamp: date, transactionCount: 3, logCount: 2, tokenTransferCount: 1 };
const transfer = { chainId: 11155111, networkName: 'sepolia', blockNumber: '42', transactionHash: hash, transactionIndex: 0, logIndex: 1, tokenAddress: address, fromAddress: address, toAddress: address, amountRaw: '123456789012345678901234567890' };

describe('Public realtime event mapping', () => {
  it('preserves bigint height and strips all internal or unrecognized payload fields', () => {
    const mapped = mapRealtimeEvent(event(EVENT_TYPES.BLOCK_INDEXED, { ...block, passwordHash: 'secret', serviceToken: 'secret' }), 11155111);
    expect(mapped).toEqual({ id: 'id-1', type: 'block.indexed', occurredAt: date, payload: block });
    expect(JSON.stringify(mapped)).not.toContain('secret');
  });
  it('normalizes public transfer addresses without leaking optional or private metadata', () => {
    const mapped = mapRealtimeEvent(event(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, { ...transfer, userId: 'private', tokenSymbol: 'TOKEN' }), 11155111);
    expect(mapped?.payload).toMatchObject({ tokenAddress: address.toLowerCase(), amountRaw: transfer.amountRaw });
    expect(JSON.stringify(mapped)).not.toContain('userId');
  });
  it('maps reorg recovery position explicitly', () => {
    const p = { chainId: 11155111, networkName: 'sepolia', detectedAtBlock: '105', commonAncestorBlock: '101', commonAncestorHash: hash };
    expect(mapRealtimeEvent(event(EVENT_TYPES.CHAIN_REORGANIZED, p), 11155111)?.type).toBe('chain.reorganized');
  });
  it.each([{ ...block, blockHash: 'broken' }, { ...block, blockNumber: 123 }, { ...block, transactionCount: -1 }, { ...block, timestamp: 'yesterday' }])('rejects malformed block payload %j', (payload) => {
    expect(mapRealtimeEvent(event(EVENT_TYPES.BLOCK_INDEXED, payload), 11155111)).toBeNull();
  });
  it('rejects events from another chain, unknown versions and private alert events', () => {
    expect(mapRealtimeEvent(event(EVENT_TYPES.BLOCK_INDEXED, block), 1)).toBeNull();
    expect(mapRealtimeEvent({ ...event(EVENT_TYPES.BLOCK_INDEXED, block), version: 2 }, 11155111)).toBeNull();
    expect(mapRealtimeEvent(event('alert.triggered', { userId: 'private' }), 11155111)).toBeNull();
  });
  it('rejects malformed transfer quantities and array payloads', () => {
    expect(mapRealtimeEvent(event(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, { ...transfer, amountRaw: '-1' }), 11155111)).toBeNull();
    expect(mapRealtimeEvent(event(EVENT_TYPES.BLOCK_INDEXED, []), 11155111)).toBeNull();
  });
});

describe('Bounded broker delivery deduplication', () => {
  it('suppresses identical IDs and permits expiry', () => {
    const dedup = new RealtimeDeduplicator(2, 100);
    expect(dedup.accept('a', 0)).toBe(true);
    expect(dedup.accept('a', 99)).toBe(false);
    expect(dedup.accept('a', 100)).toBe(true);
  });
  it('evicts the oldest key when capacity is reached', () => {
    const dedup = new RealtimeDeduplicator(2, 100);
    dedup.accept('a', 0); dedup.accept('b', 1); dedup.accept('c', 2);
    expect(dedup.accept('b', 3)).toBe(false);
    expect(dedup.accept('a', 3)).toBe(true);
  });
});
