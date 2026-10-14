import { ConfigService } from '@nestjs/config';
import type { OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection, type OnGatewayDisconnect, type OnGatewayInit } from '@nestjs/websockets';
import { WebSocket, type WebSocketServer, type VerifyClientCallbackAsync } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts';
import { recordCounter, recordGauge } from '@blockchain-explorer/observability';

export function isAllowedRealtimeOrigin(origin: string | undefined, webOrigin: string): boolean {
  // Origin-less CLI/native clients receive only already-public Explorer data.
  if (origin === undefined || origin === '') return true;
  return origin === webOrigin;
}

const verifyOrigin: VerifyClientCallbackAsync = (info, callback) => {
  const allowed = isAllowedRealtimeOrigin(info.origin, process.env.WEB_ORIGIN ?? 'http://localhost:3003');
  callback(allowed, allowed ? undefined : 403, allowed ? undefined : 'Origin is not allowed');
};

@WebSocketGateway({ path: '/realtime', maxPayload: 1_024, perMessageDeflate: false, verifyClient: verifyOrigin })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleDestroy {
  private readonly clients = new Map<WebSocket, { alive: boolean; messages: number; windowStart: number; ip: string }>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly origin: string;
  private readonly maxClients: number;

  constructor(config: ConfigService) {
    this.origin = config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3003';
    const configured = Number(config.get('REALTIME_MAX_CLIENTS') ?? 500);
    this.maxClients = Number.isInteger(configured) && configured > 0 && configured <= 10_000 ? configured : 500;
  }

  afterInit(_server: WebSocketServer): void {
    recordGauge('websocket_connections_active', 0);
    this.heartbeat = setInterval(() => {
      for (const [client, state] of this.clients) {
        if (!state.alive || client.readyState !== WebSocket.OPEN || client.bufferedAmount > 262_144) {
          this.removeClient(client); client.terminate(); continue;
        }
        state.alive = false;
        try { client.ping(); } catch { this.removeClient(client); client.terminate(); }
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const ip = request.socket.remoteAddress ?? 'unknown';
    const peers = [...this.clients.values()].filter((state) => state.ip === ip).length;
    if (!isAllowedRealtimeOrigin(request.headers.origin, this.origin) || this.clients.size >= this.maxClients || peers >= 20) {
      client.close(1008, 'Connection is not allowed'); return;
    }
    const state = { alive: true, messages: 0, windowStart: Date.now(), ip };
    this.clients.set(client, state);
    recordCounter('websocket_connections_total');
    recordGauge('websocket_connections_active', this.clients.size);
    client.on('pong', () => { state.alive = true; });
    client.on('error', () => { this.removeClient(client); client.terminate(); });
    // Public broadcasts have no client-submitted subscriptions, identities or commands.
    client.on('message', () => {
      const now = Date.now();
      if (now - state.windowStart > 10_000) { state.windowStart = now; state.messages = 0; }
      state.messages += 1;
      if (state.messages > 5) { this.removeClient(client); client.close(1008, 'Client message limit exceeded'); }
    });
  }

  handleDisconnect(client: WebSocket): void { this.removeClient(client); }

  private removeClient(client: WebSocket): void {
    if (this.clients.delete(client)) {
      recordCounter('websocket_disconnects_total');
      recordGauge('websocket_connections_active', this.clients.size);
    }
  }

  broadcast(event: RealtimeExplorerEvent): void {
    recordCounter('websocket_events_broadcast_total', 1, { event_type: event.type });
    const body = JSON.stringify(event);
    for (const client of this.clients.keys()) {
      if (client.readyState !== WebSocket.OPEN || client.bufferedAmount > 262_144) {
        this.removeClient(client); client.terminate(); continue;
      }
      try { client.send(body, (error) => { if (error) { recordCounter('websocket_broadcast_errors_total', 1, { event_type: event.type }); this.removeClient(client); client.terminate(); } }); }
      catch { recordCounter('websocket_broadcast_errors_total', 1, { event_type: event.type }); this.removeClient(client); client.terminate(); }
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.clients.keys()) {
      this.removeClient(client);
      client.close(1001, 'Server shutting down');
      const timer = setTimeout(() => client.terminate(), 500); timer.unref();
    }
    this.clients.clear();
  }
}
