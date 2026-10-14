import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventDeduplicator, RealtimeClient, reconnectDelay, type ConnectionState, type SocketHandlers } from './realtime-client';
import { decodeRealtimeEvent } from './realtime.decoder';
const block = { id: 'event-1', type: 'block.indexed', occurredAt: '2026-10-14T10:00:00.000Z', payload: { chainId: 11155111, networkName: 'Sepolia', blockNumber: '90071992547409931234', blockHash: `0x${'aa'.repeat(32)}`, parentHash: `0x${'bb'.repeat(32)}`, timestamp: '2026-10-14T10:00:00.000Z', transactionCount: 2, logCount: 3, tokenTransferCount: 1 } };
function fixture(url = 'ws://localhost:3000/realtime') {
  const states: ConnectionState[] = [], events: RealtimeExplorerEvent[] = [], sockets: { handlers: SocketHandlers; closed: boolean }[] = [];
  const client = new RealtimeClient(url, state => states.push(state), event => events.push(event), (_url, handlers) => { const socket = { handlers, closed: false }; sockets.push(socket); return { close() { socket.closed = true; } }; });
  return { client, states, events, sockets };
}
describe('Native realtime lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(1); });
  afterEach(() => { vi.useRealTimers(); });
  it('connects and emits validated public events', () => { const f = fixture(); f.client.start(); f.sockets[0].handlers.open(); f.sockets[0].handlers.message(JSON.stringify(block)); expect(f.states).toEqual(['connecting', 'live']); expect(f.events).toEqual([block]); f.client.stop(); });
  it('suppresses duplicate event delivery across reconnects', () => { const f = fixture(); f.client.start(); f.sockets[0].handlers.open(); f.sockets[0].handlers.message(JSON.stringify(block)); f.sockets[0].handlers.close(); vi.advanceTimersByTime(500); f.sockets[1].handlers.message(JSON.stringify(block)); expect(f.events).toHaveLength(1); f.client.stop(); });
  it('reconnects with capped exponential backoff', () => { const f = fixture(); f.client.start(); f.sockets[0].handlers.close(); vi.advanceTimersByTime(499); expect(f.sockets).toHaveLength(1); vi.advanceTimersByTime(1); expect(f.sockets).toHaveLength(2); f.sockets[1].handlers.close(); vi.advanceTimersByTime(999); expect(f.sockets).toHaveLength(2); vi.advanceTimersByTime(1); expect(f.sockets).toHaveLength(3); f.client.stop(); });
  it('cleans sockets and pending reconnect on stop', () => { const f = fixture(); f.client.start(); f.sockets[0].handlers.close(); f.client.stop(); vi.advanceTimersByTime(60000); expect(f.sockets).toHaveLength(1); expect(f.sockets[0].closed).toBe(true); });
  it('does not connect while offline and resumes when online', () => { const f = fixture(); f.client.start(false); expect(f.sockets).toHaveLength(0); expect(f.states).toEqual(['offline']); f.client.setOnline(true); expect(f.sockets).toHaveLength(1); f.client.setOnline(false); expect(f.sockets[0].closed).toBe(true); vi.advanceTimersByTime(60000); expect(f.sockets).toHaveLength(1); f.client.stop(); });
  it('ignores callbacks from a closed generation', () => { const f = fixture(); f.client.start(); f.client.setOnline(false); f.sockets[0].handlers.message(JSON.stringify(block)); f.sockets[0].handlers.open(); expect(f.events).toHaveLength(0); expect(f.states.at(-1)).toBe('offline'); f.client.stop(); });
  it('isolates malformed and oversized messages', () => { const f = fixture(); f.client.start(); for (const message of ['{', JSON.stringify({ ...block, type: 'alert.triggered' }), 'x'.repeat(131073), { data: 'invalid' }]) f.sockets[0].handlers.message(message); expect(f.events).toHaveLength(0); f.client.stop(); });
  it('bounds a hanging handshake and schedules another connection', () => { const f = fixture(); f.client.start(); vi.advanceTimersByTime(15000); expect(f.sockets[0].closed).toBe(true); vi.advanceTimersByTime(500); expect(f.sockets).toHaveLength(2); f.client.stop(); });
  it.each(['https://localhost/realtime', 'ws://user:secret@localhost/realtime', 'broken'])('rejects websocket URL %s', url => { const f = fixture(url); f.client.start(); expect(f.states).toEqual(['unconfigured']); expect(f.sockets).toHaveLength(0); f.client.stop(); });
  it('catches constructor failure and retries without crashing consumers', () => { const states: ConnectionState[] = []; const client = new RealtimeClient('ws://localhost/realtime', state => states.push(state), () => {}, () => { throw new Error('Transport unavailable'); }); client.start(); expect(states).toEqual(['connecting', 'reconnecting']); client.stop(); });
});
describe('Realtime bounds and decoding', () => {
  it('caps backoff and bounds jitter', () => { expect(reconnectDelay(0, 0)).toBe(375); expect(reconnectDelay(1, 1)).toBe(1000); expect(reconnectDelay(999, 1)).toBe(30000); });
  it('limits duplicate-cache memory and expires old entries', () => { const cache = new EventDeduplicator(2, 100); expect(cache.accept('a', 0)).toBe(true); expect(cache.accept('a', 1)).toBe(false); cache.accept('b', 2); cache.accept('c', 3); expect(cache.size).toBe(2); expect(cache.accept('a', 4)).toBe(true); expect(cache.accept('c', 104)).toBe(true); });
  it('validates huge block heights as strings', () => { expect(decodeRealtimeEvent(block)).toEqual(block); expect(() => decodeRealtimeEvent({ ...block, payload: { ...block.payload, blockNumber: 123 } })).toThrow(); });
});
