import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts/browser';
import { decodeRealtimeEvent } from './realtime.decoder';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unconfigured';
export function reconnectDelay(attempt: number, random = Math.random()): number { return Math.round(Math.min(30000, 500 * 2 ** Math.min(16, Math.max(0, attempt))) * (0.75 + Math.min(1, Math.max(0, random)) * 0.25)); }
export class EventDeduplicator {
  private readonly entries = new Map<string, number>();
  constructor(private readonly limit = 1024, private readonly ttlMs = 300000) {}
  accept(key: string, now = Date.now()): boolean {
    for (const [entry, time] of this.entries) { if (now - time < this.ttlMs) break; this.entries.delete(entry); }
    if (this.entries.has(key)) return false;
    this.entries.set(key, now);
    while (this.entries.size > this.limit) { const first = this.entries.keys().next(); if (!first.done) this.entries.delete(first.value); }
    return true;
  }
  get size(): number { return this.entries.size; }
}
export interface SocketHandlers { open(): void; close(): void; message(value: unknown): void; }
export interface SocketConnection { close(): void; }
export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketConnection;
export function nativeSocketFactory(url: string, handlers: SocketHandlers): SocketConnection {
  const socket = new WebSocket(url);
  socket.onopen = handlers.open;
  socket.onclose = handlers.close;
  socket.onerror = () => socket.close();
  socket.onmessage = event => handlers.message(event.data);
  return { close() { socket.onopen = null; socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.close(); } };
}
export class RealtimeClient {
  private socket: SocketConnection | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private stopped = true;
  private online = true;
  private attempt = 0;
  private readonly dedup = new EventDeduplicator();
  constructor(private readonly url: string, private readonly notify: (state: ConnectionState) => void, private readonly emit: (event: RealtimeExplorerEvent) => void, private readonly factory: SocketFactory = nativeSocketFactory) {}
  start(online = true): void { this.disconnect(); this.stopped = false; this.online = online; this.attempt = 0; this.connect(); }
  stop(): void { this.stopped = true; this.disconnect(); }
  setOnline(online: boolean): void { if (this.online === online || this.stopped) return; this.online = online; this.disconnect(); if (online) { this.attempt = 0; this.connect(); } else this.notify('offline'); }
  private disconnect(): void { this.generation++; clearTimeout(this.timer); clearTimeout(this.handshake); this.socket?.close(); this.socket = null; }
  private connect(): void {
    if (this.stopped) return;
    if (!this.online) { this.notify('offline'); return; }
    let url: URL;
    try { url = new URL(this.url); if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid websocket URL'); }
    catch { this.notify('unconfigured'); return; }
    this.notify(this.attempt ? 'reconnecting' : 'connecting');
    const generation = ++this.generation;
    const active = () => !this.stopped && this.generation === generation;
    const closed = () => { if (!active()) return; this.disconnect(); if (!this.online) { this.notify('offline'); return; } this.notify('reconnecting'); this.timer = setTimeout(() => this.connect(), reconnectDelay(this.attempt++)); };
    try {
      this.socket = this.factory(url.href, {
        open: () => { if (active()) { clearTimeout(this.handshake); this.attempt = 0; this.notify('live'); } },
        close: closed,
        message: value => { if (!active() || typeof value !== 'string' || value.length > 131072) return; try { const decoded: unknown = JSON.parse(value); const event = decodeRealtimeEvent(decoded); if (this.dedup.accept(`${event.type}:${event.id}`)) this.emit(event); } catch { /* Invalid public messages are isolated from the UI. */ } },
      });
      this.handshake = setTimeout(closed, 15000);
    } catch { closed(); }
  }
}
