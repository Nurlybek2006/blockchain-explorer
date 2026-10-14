import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { WebSocket, WebSocketServer } from 'ws';
import { RealtimeGateway, isAllowedRealtimeOrigin } from './realtime.gateway.js';
import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts';

describe('Public native WebSocket boundary', () => {
  it('accepts only the configured browser origin or anonymous native clients', () => {
    expect(isAllowedRealtimeOrigin('http://localhost:3003', 'http://localhost:3003')).toBe(true);
    expect(isAllowedRealtimeOrigin(undefined, 'http://localhost:3003')).toBe(true);
    expect(isAllowedRealtimeOrigin('https://evil.test', 'http://localhost:3003')).toBe(false);
    expect(isAllowedRealtimeOrigin('http://localhost:3003.evil.test', 'http://localhost:3003')).toBe(false);
    expect(isAllowedRealtimeOrigin('null', 'http://localhost:3003')).toBe(false);
  });
  it('broadcasts public DTOs, handles disconnects, and closes socket resources', async () => {
    const gateway = new RealtimeGateway(new ConfigService());
    const server = new WebSocketServer({ port: 0 }); gateway.afterInit(server);
    server.on('connection', (client, request) => { gateway.handleConnection(client, request); client.on('close', () => gateway.handleDisconnect(client)); });
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Expected test socket port');
    const client = new WebSocket(`ws://127.0.0.1:${bound.port}`, { origin: 'http://localhost:3003' });
    await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
    const event: RealtimeExplorerEvent = { id: 'test', type: 'chain.reorganized', occurredAt: '2026-10-14T00:00:00.000Z', payload: { chainId: 11155111, networkName: 'sepolia', detectedAtBlock: '42', commonAncestorBlock: '40', commonAncestorHash: null } };
    const message = new Promise<string>((resolve) => client.once('message', (data) => resolve(data.toString())));
    gateway.broadcast(event); expect(JSON.parse(await message)).toEqual(event);
    const closed = new Promise<number>((resolve) => client.once('close', resolve)); gateway.onModuleDestroy(); expect(await closed).toBe(1001);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('bounds abusive inbound messages without disabling public REST/core state', async () => {
    const gateway = new RealtimeGateway(new ConfigService());
    const server = new WebSocketServer({ port: 0 }); gateway.afterInit(server);
    server.on('connection', (client, request) => gateway.handleConnection(client, request));
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Expected test socket port');
    const client = new WebSocket(`ws://127.0.0.1:${bound.port}`);
    await new Promise<void>((resolve) => client.once('open', resolve));
    const closed = new Promise<number>((resolve) => client.once('close', resolve));
    for (let i = 0; i < 6; i++) client.send('unsupported-client-command');
    expect(await closed).toBe(1008); gateway.onModuleDestroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('runs heartbeat checks without keeping the process alive', () => {
    vi.useFakeTimers(); const gateway = new RealtimeGateway(new ConfigService());
    const server = new WebSocketServer({ noServer: true }); gateway.afterInit(server);
    vi.advanceTimersByTime(30_000); gateway.onModuleDestroy(); server.close(); vi.useRealTimers();
  });
});
