import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { WebSocket, WebSocketServer } from 'ws';
import * as telemetry from '@blockchain-explorer/observability';
import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts';
import { RealtimeGateway } from './realtime.gateway.js';

vi.mock('@blockchain-explorer/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blockchain-explorer/observability')>();
  return { ...actual, recordCounter: vi.fn(), recordGauge: vi.fn() };
});

const event: RealtimeExplorerEvent = {
  id: 'fixture-event', type: 'chain.reorganized', occurredAt: '2026-10-14T00:00:00.000Z',
  payload: { chainId: 11155111, networkName: 'sepolia', detectedAtBlock: '42', commonAncestorBlock: '40', commonAncestorHash: null },
};

describe('native WebSocket telemetry lifecycle', () => {
  const cleanup: Array<() => Promise<void>> = [];
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.restoreAllMocks(); });

  async function fixture(origin = 'http://localhost:3003') {
    const gateway = new RealtimeGateway(new ConfigService());
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    const accepted: WebSocket[] = [];
    gateway.afterInit(server);
    server.on('connection', (socket, request) => {
      accepted.push(socket); gateway.handleConnection(socket, request);
      socket.on('close', () => gateway.handleDisconnect(socket));
    });
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Expected loopback port');
    const client = new WebSocket(`ws://127.0.0.1:${bound.port}`, { origin });
    cleanup.push(async () => {
      gateway.onModuleDestroy(); client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
    return { gateway, client, accepted };
  }

  it('counts an accepted connection and repeated disconnect notifications exactly once', async () => {
    const { gateway, client, accepted } = await fixture();
    const socket = accepted[0]; if (!socket) throw new Error('Missing accepted socket');
    expect(telemetry.recordCounter).toHaveBeenCalledWith('websocket_connections_total');
    expect(telemetry.recordGauge).toHaveBeenCalledWith('websocket_connections_active', 1);
    const serverClosed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    client.close(); await serverClosed;
    gateway.handleDisconnect(socket); gateway.handleDisconnect(socket); gateway.onModuleDestroy();
    expect(vi.mocked(telemetry.recordCounter).mock.calls.filter(([name]) => name === 'websocket_connections_total')).toHaveLength(1);
    expect(vi.mocked(telemetry.recordCounter).mock.calls.filter(([name]) => name === 'websocket_disconnects_total')).toHaveLength(1);
    expect(telemetry.recordGauge).toHaveBeenLastCalledWith('websocket_connections_active', 0);
  });

  it('does not count rejected origins as accepted or disconnected clients', async () => {
    const { client } = await fixture('https://untrusted.invalid');
    const code = await new Promise<number>((resolve) => client.once('close', resolve));
    expect(code).toBe(1008);
    expect(telemetry.recordCounter).not.toHaveBeenCalled();
    expect(vi.mocked(telemetry.recordGauge).mock.calls).toEqual([['websocket_connections_active', 0]]);
  });

  it('records one disconnect when socket errors are followed by normal close callbacks', async () => {
    const { gateway, client, accepted } = await fixture();
    const socket = accepted[0]; if (!socket) throw new Error('Missing accepted socket');
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    socket.emit('error', new Error('Fixture socket error')); await closed;
    gateway.handleDisconnect(socket);
    expect(vi.mocked(telemetry.recordCounter).mock.calls.filter(([name]) => name === 'websocket_disconnects_total')).toHaveLength(1);
    expect(telemetry.recordGauge).toHaveBeenLastCalledWith('websocket_connections_active', 0);
  });

  it('records broadcast failures with only the bounded event type and removes the failed client', async () => {
    const { gateway, client, accepted } = await fixture();
    const socket = accepted[0]; if (!socket) throw new Error('Missing accepted socket');
    vi.spyOn(socket, 'send').mockImplementation(() => { throw new Error('Fixture send failure'); });
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    gateway.broadcast(event); await closed;
    expect(telemetry.recordCounter).toHaveBeenCalledWith('websocket_events_broadcast_total', 1, { event_type: 'chain.reorganized' });
    expect(telemetry.recordCounter).toHaveBeenCalledWith('websocket_broadcast_errors_total', 1, { event_type: 'chain.reorganized' });
    expect(vi.mocked(telemetry.recordCounter).mock.calls.filter(([name]) => name === 'websocket_disconnects_total')).toHaveLength(1);
    expect(JSON.stringify(vi.mocked(telemetry.recordCounter).mock.calls)).not.toContain(event.id);
  });
});
