import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AlertsController } from './alerts.controller.js';
import { PricesController } from './prices.controller.js';
import { WatchlistsController } from './watchlists.controller.js';
import { IntelligenceClient } from './intelligence.client.js';
import { CreateAlertDto, CreateWatchlistDto, CreateWatchlistItemDto, PortfolioHistoryQueryDto, UpdateAlertDto } from './dto/intelligence.dto.js';

const owner = '1c456442-040c-43b0-af96-f616b329710e';
const resourceId = 'cfed8eb3-433d-45cc-ac9a-f8c5ca5102d3';
const other = 'bcf0a8a3-34d4-47f9-9c5d-893a89c3c0d8';
const address = `0x${'a'.repeat(40)}`;
const date = '2026-10-14T00:00:00.000Z';
const watchlist = { id: resourceId, name: 'Mine', createdAt: date };
const alert = { id: resourceId, type: 'wallet_activity', enabled: true, walletAddress: address, tokenAddress: null, thresholdUsd: null, createdAt: date, updatedAt: date };

class RecordingClient extends IntelligenceClient {
  calls: { method: string; path: string; query: Record<string, string | number> | undefined; body: object | undefined }[] = [];
  reply: unknown = watchlist;
  constructor() { super(new ConfigService({ INTERNAL_SERVICE_TOKEN: 'test-internal-token' })); }
  protected override async request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, query?: Record<string, string | number>, body?: object): Promise<unknown> {
    this.calls.push({ method, path, query, body });
    return this.reply;
  }
}

describe('Intelligence Gateway owner propagation', () => {
  it('uses the authenticated owner for create bodies and strips unrecognized input properties', async () => {
    const client = new RecordingClient();
    const controller = new WatchlistsController(client);
    const forged = Object.assign(new CreateWatchlistDto(), { name: 'Mine', userId: other, admin: true });
    await controller.create({ id: owner, email: 'owner@example.com', role: 'user' }, forged);
    expect(client.calls[0]).toMatchObject({ method: 'POST', path: '/internal/watchlists', body: { userId: owner, name: 'Mine' } });
    expect(client.calls[0]?.body).not.toHaveProperty('admin');
    expect(client.calls[0]?.body).not.toHaveProperty('userId', other);
    client.reply = alert;
    await client.createAlert(owner, Object.assign(new CreateAlertDto(), { type: 'wallet_activity', walletAddress: address, userId: other }));
    expect(client.calls[1]?.body).toEqual({ userId: owner, type: 'wallet_activity', walletAddress: address });
  });

  it('passes ownership to watchlist, item and alert-event mutations rather than accepting body IDs', async () => {
    const client = new RecordingClient();
    client.reply = { ...watchlist, items: [] };
    await client.watchlist(owner, resourceId);
    await client.deleteWatchlistItem(owner, resourceId, other);
    client.reply = { id: resourceId, alertId: other, title: 'Activity', message: null, payload: {}, triggeredAt: date, readAt: date };
    await client.markAlertRead(owner, resourceId);
    expect(client.calls.map((call) => call.query)).toEqual([{ userId: owner }, { userId: owner }, { userId: owner }]);
    expect(client.calls[1]?.path).toBe(`/internal/watchlists/${resourceId}/items/${other}`);
    expect(client.calls[2]?.path).toBe(`/internal/alerts/events/${resourceId}/read`);
  });

  it('rejects empty alert PATCH before contacting the backend and permits an explicit false enabled value', async () => {
    const client = new RecordingClient();
    client.reply = { ...alert, enabled: false };
    await expect(client.updateAlert(owner, resourceId, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(client.calls).toHaveLength(0);
    await client.updateAlert(owner, resourceId, { enabled: false });
    expect(client.calls[0]?.body).toEqual({ enabled: false });
  });

  it('keeps watchlist/alert controllers JWT protected while price reads remain public and validate addresses', () => {
    const watchlistGuards: unknown = Reflect.getMetadata(GUARDS_METADATA, WatchlistsController);
    const alertGuards: unknown = Reflect.getMetadata(GUARDS_METADATA, AlertsController);
    const priceGuards: unknown = Reflect.getMetadata(GUARDS_METADATA, PricesController);
    expect(watchlistGuards).toContain(JwtAuthGuard);
    expect(alertGuards).toContain(JwtAuthGuard);
    expect(priceGuards).toBeUndefined();
    const client = new RecordingClient();
    expect(() => new PricesController(client).token('0xnot-an-address')).toThrow(BadRequestException);
    expect(client.calls).toHaveLength(0);
  });
});

describe('Intelligence request DTO validation', () => {
  it('whitelists caller fields and rejects userId spoofing instead of silently trusting it', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(pipe.transform({ name: 'Mine', userId: other }, { type: 'body', metatype: CreateWatchlistDto }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ range: '7d', userId: other }, { type: 'query', metatype: PortfolioHistoryQueryDto }))
      .rejects.toBeInstanceOf(BadRequestException);
    const accepted: unknown = await pipe.transform({ name: ' Mine ' }, { type: 'body', metatype: CreateWatchlistDto });
    expect(accepted).toMatchObject({ name: 'Mine' });
  });

  it('rejects malformed watchlist items, empty trimmed names and label bounds', async () => {
    for (const input of [{ itemType: 'nft', address }, { itemType: 'address', address: 'bad' }, { itemType: 'token', address, label: ' '.repeat(5) }, { itemType: 'token', address, label: 'x'.repeat(101) }]) {
      expect((await validate(plainToInstance(CreateWatchlistItemDto, input))).length).toBeGreaterThan(0);
    }
    expect((await validate(plainToInstance(CreateWatchlistDto, { name: ' ' }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(CreateWatchlistItemDto, { itemType: 'token', address, label: ' Token ' }))).toHaveLength(0);
  });

  it('requires decimal-string thresholds and alert-type-specific create settings', async () => {
    for (const input of [
      { type: 'price_above', thresholdUsd: 100 }, { type: 'price_above', thresholdUsd: '0' },
      { type: 'price_below', thresholdUsd: '-1' }, { type: 'price_above', thresholdUsd: '1e3' },
      { type: 'wallet_activity' }, { type: 'wallet_activity', walletAddress: address, thresholdUsd: '1' },
      { type: 'price_above', thresholdUsd: '1', walletAddress: address }, { type: 'whale', enabled: 'true' },
    ]) expect((await validate(plainToInstance(CreateAlertDto, input))).length).toBeGreaterThan(0);
    for (const input of [{ type: 'price_above', thresholdUsd: '9007199254740993.000000000000000001' }, { type: 'wallet_activity', walletAddress: address }, { type: 'whale' }]) {
      expect(await validate(plainToInstance(CreateAlertDto, input))).toHaveLength(0);
    }
    expect(await validate(plainToInstance(UpdateAlertDto, { enabled: false, walletAddress: null, thresholdUsd: null }))).toHaveLength(0);
  });

  it('bounds and converts history point limits without permitting unknown ranges', async () => {
    expect(await validate(plainToInstance(PortfolioHistoryQueryDto, { range: '90d', limit: '1000' }))).toHaveLength(0);
    for (const input of [{ range: 'year' }, { limit: '1' }, { limit: '1001' }, { limit: '2.5' }]) {
      expect((await validate(plainToInstance(PortfolioHistoryQueryDto, input))).length).toBeGreaterThan(0);
    }
  });
});
