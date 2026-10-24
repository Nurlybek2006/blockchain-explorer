import { describe, expect, it } from 'vitest';
import {
  createEventEnvelope, EVENT_TYPES, isAssetKey, isChainReorganizedEvent, isEthereumAddress, isEventEnvelope,
  isTokenTransferIndexedEvent, normalizeAssetKey, normalizeEthereumAddress
} from './index.js';

const address = `0x${'a'.repeat(40)}`;
const hash = `0x${'1'.repeat(64)}`;
const payload = {
  chainId: 11155111, networkName: 'ethereum-sepolia', blockNumber: '9007199254740993',
  transactionHash: hash, transactionIndex: 0, logIndex: 0, tokenAddress: address,
  fromAddress: address, toAddress: address, amountRaw: '900719925474099300000000000', tokenDecimals: 18, tokenSymbol: 'TC'
};

describe('shared public and versioned event contracts', () => {
  it('creates UUID v1 envelopes with parseable UTC time and preserves exact decimal strings', () => {
    const event = createEventEnvelope(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, 'indexer-service', payload);
    expect(event.id).toMatch(/^[\da-f-]{36}$/); expect(event.version).toBe(1);
    expect(Number.isFinite(Date.parse(event.occurredAt))).toBe(true);
    expect(isEventEnvelope(event)).toBe(true); expect(event.payload.amountRaw).toBe(payload.amountRaw);
  });
  it('accepts the current token transfer contract including optional metadata', () => {
    expect(isTokenTransferIndexedEvent(createEventEnvelope(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, 'indexer-service', payload))).toBe(true);
    expect(isTokenTransferIndexedEvent(createEventEnvelope(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, 'indexer-service', { ...payload, tokenDecimals: undefined, tokenSymbol: undefined }))).toBe(true);
  });
  it.each(['amountRaw', 'blockNumber'])('rejects numeric precision loss in %s', (field) => {
    const event = createEventEnvelope(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, 'indexer-service', { ...payload, [field]: 9007199254740992 });
    expect(isTokenTransferIndexedEvent(event)).toBe(false);
  });
  it('rejects unknown event version and invalid chain/log coordinates', () => {
    const event = createEventEnvelope(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, 'indexer-service', payload);
    expect(isTokenTransferIndexedEvent({ ...event, version: 2 })).toBe(false);
    expect(isTokenTransferIndexedEvent({ ...event, payload: { ...payload, chainId: -1 } })).toBe(false);
    expect(isTokenTransferIndexedEvent({ ...event, payload: { ...payload, logIndex: -1 } })).toBe(false);
  });
  it('bounds token decimals/symbol and validates all Ethereum coordinates', () => {
    const event = createEventEnvelope(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, 'indexer-service', payload);
    for (const patch of [{ tokenDecimals: 256 }, { tokenSymbol: 'x'.repeat(65) }, { transactionHash: address }, { fromAddress: hash }]) {
      expect(isTokenTransferIndexedEvent({ ...event, payload: { ...payload, ...patch } })).toBe(false);
    }
  });
  it('reorg contract accepts known or unknown ancestor hash while retaining exact heights', () => {
    const data = { chainId: 11155111, networkName: 'ethereum-sepolia', detectedAtBlock: '9007199254740994', commonAncestorBlock: '9007199254740993', commonAncestorHash: hash };
    const event = createEventEnvelope(EVENT_TYPES.CHAIN_REORGANIZED, 'indexer-service', data);
    expect(isChainReorganizedEvent(event)).toBe(true);
    expect(isChainReorganizedEvent({ ...event, payload: { ...data, commonAncestorHash: null } })).toBe(true);
    expect(isChainReorganizedEvent({ ...event, payload: { ...data, commonAncestorHash: address } })).toBe(false);
  });
  it('rejects missing envelopes and does not guess an event payload', () => {
    for (const value of [null, [], 'event', { id: 'id' }, { id: 'id', type: 'event', version: 1, producer: 'indexer', occurredAt: 'time' }]) expect(isEventEnvelope(value)).toBe(false);
  });
  it('normalizes only valid Ethereum addresses and rejects malformed input', () => {
    expect(normalizeEthereumAddress(` ${address.toUpperCase().replace('0X', '0x')} `)).toBe(address);
    expect(isEthereumAddress(hash)).toBe(false); expect(() => normalizeEthereumAddress('0x1234')).toThrow();
  });
  it('asset keys use one canonical native/token form', () => {
    expect(normalizeAssetKey(`erc20:${address.toUpperCase().replace('0X', '0x')}`)).toBe(`erc20:${address}`);
    expect(normalizeAssetKey('native:eth')).toBe('native:eth'); expect(isAssetKey(`erc20:${address}`)).toBe(true);
    expect(isAssetKey('native:btc')).toBe(false); expect(() => normalizeAssetKey('unknown')).toThrow();
  });
});
