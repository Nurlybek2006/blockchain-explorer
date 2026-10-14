import 'reflect-metadata';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Erc20Client } from '@blockchain-explorer/blockchain-client';
import {
  createEventEnvelope,
  EVENT_TYPES,
  type AssetPriceResponse,
  type TokenTransferIndexedEvent,
  type TokenTransferIndexedPayload,
} from '@blockchain-explorer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PricesService } from '../prices/prices.service.js';
import type { AlertEventRecord, AlertRecord, AlertsRepository, NewAlertEvent } from './alerts.repository.js';
import { AlertsService } from './alerts.service.js';
import { CreateAlertDto, UpdateAlertDto } from './dto/alert.dto.js';

const owner = 'f7d40b53-53b2-449b-b16a-673c93dc7d2c';
const foreign = 'f7d40b53-53b2-449b-b16a-673c93dc7d2d';
const id = '02d10b90-e68c-4604-b9af-a85c32830679';
const wallet = `0x${'b'.repeat(40)}`;
const token = `0x${'a'.repeat(40)}`;
const date = new Date('2026-10-14T00:00:00.000Z');
const whale: AlertRecord = {
  id, userId: owner, type: 'whale', enabled: true, walletAddress: null, tokenAddress: null,
  thresholdUsd: '100000', lastConditionMet: null, lastEvaluatedAt: null, createdAt: date, updatedAt: date,
};
const activity: AlertRecord = { ...whale, id: foreign, type: 'wallet_activity', walletAddress: wallet, thresholdUsd: null };
const eventRow: AlertEventRecord = {
  id: foreign, alertId: id, title: 'Transfer', message: null, payload: {}, eventKey: 'test', triggeredAt: date, readAt: date,
};
const price: AssetPriceResponse = {
  assetKey: `erc20:${token}`, tokenAddress: token, coinGeckoId: 'test', symbol: 'TEST', priceUsd: '1',
  change24hPercent: null, marketCapUsd: null, fetchedAt: date.toISOString(), availability: 'available', stale: false,
};
function transfer(overrides: Partial<TokenTransferIndexedPayload> = {}): TokenTransferIndexedEvent {
  return createEventEnvelope(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, 'indexer-service', {
    chainId: 11155111, networkName: 'sepolia', blockNumber: '9007199254740993',
    transactionHash: `0x${'1'.repeat(64)}`, transactionIndex: 1, logIndex: 2,
    tokenAddress: token, fromAddress: wallet, toAddress: `0x${'c'.repeat(40)}`,
    amountRaw: '100000000000000000000001', tokenDecimals: 18, tokenSymbol: 'TEST', ...overrides,
  });
}
type Store = Pick<AlertsRepository,
  'create' | 'list' | 'findOwned' | 'updateOwned' | 'deleteOwned' | 'listEvents' | 'markReadOwned'
  | 'transferRules' | 'insertTransferEvent' | 'evaluatePrice'>;

describe('AlertsService security and transfer evaluation', () => {
  let store: Store;
  let prices: Pick<PricesService, 'subscribe' | 'getPrice'>;
  let metadata: Pick<Erc20Client, 'decimals'>;
  let service: AlertsService;
  let inserted: Array<{ alertId: string; key: string; event: NewAlertEvent }>;
  let rules: AlertRecord[];

  beforeEach(() => {
    inserted = [];
    rules = [activity, whale];
    store = {
      create: vi.fn<Store['create']>().mockResolvedValue(whale),
      list: vi.fn<Store['list']>().mockResolvedValue({ items: [whale], total: 1 }),
      findOwned: vi.fn<Store['findOwned']>().mockImplementation(async (userId) => userId === owner ? whale : null),
      updateOwned: vi.fn<Store['updateOwned']>().mockImplementation(async (userId, _id, decide) => {
        if (userId !== owner) throw new NotFoundException('Alert not found');
        return { ...whale, ...decide(whale) };
      }),
      deleteOwned: vi.fn<Store['deleteOwned']>().mockResolvedValue(false),
      listEvents: vi.fn<Store['listEvents']>().mockResolvedValue({ items: [eventRow], total: 1 }),
      markReadOwned: vi.fn<Store['markReadOwned']>().mockImplementation(async (userId) => userId === owner ? eventRow : null),
      transferRules: vi.fn<Store['transferRules']>().mockImplementation(async () => rules),
      insertTransferEvent: vi.fn<Store['insertTransferEvent']>().mockImplementation(async (alertId, key, decide) => {
        const current = rules.find((rule) => rule.id === alertId);
        if (!current) return false;
        const event = decide(current);
        if (!event || inserted.some((entry) => entry.alertId === alertId && entry.key === key)) return false;
        inserted.push({ alertId, key, event });
        return true;
      }),
      evaluatePrice: vi.fn<Store['evaluatePrice']>().mockResolvedValue(),
    };
    prices = {
      subscribe: vi.fn<PricesService['subscribe']>().mockReturnValue(vi.fn()),
      getPrice: vi.fn<PricesService['getPrice']>().mockResolvedValue(price),
    };
    metadata = { decimals: vi.fn<Erc20Client['decimals']>().mockResolvedValue(18) };
    service = new AlertsService(store, prices, metadata, new ConfigService());
  });

  it('scopes alert reads, updates, deletion and event reads to the owner', async () => {
    await expect(service.detail(foreign, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(foreign, id, { enabled: false })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(foreign, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.markRead(foreign, eventRow.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(store.findOwned).toHaveBeenCalledWith(foreign, id);
    expect(store.updateOwned).toHaveBeenCalledWith(foreign, id, expect.any(Function));
    expect(store.deleteOwned).toHaveBeenCalledWith(foreign, id);
    expect(store.markReadOwned).toHaveBeenCalledWith(foreign, eventRow.id);
    await service.events(owner, 1, 20);
    expect(store.listEvents).toHaveBeenCalledWith(owner, 1, 20);
  });

  it('uses the configured whale default and normalizes filter addresses', async () => {
    const configured = new AlertsService(store, prices, metadata, new ConfigService({ WHALE_DEFAULT_THRESHOLD_USD: '123.000000000000000001' }));
    expect(await configured.create(owner, { type: 'whale', tokenAddress: token.toUpperCase().replace('0X', '0x') })).not.toHaveProperty('userId');
    expect(store.create).toHaveBeenCalledWith(owner, expect.objectContaining({
      thresholdUsd: '123.000000000000000001', tokenAddress: token, enabled: true,
    }));
  });

  it('rejects non-scalar whale configuration instead of coercing arrays or custom objects', () => {
    for (const threshold of [['100000'], { toString: () => '100000' }, true]) {
      expect(() => new AlertsService(store, prices, metadata, new ConfigService({ WHALE_DEFAULT_THRESHOLD_USD: threshold })))
        .toThrow('WHALE_DEFAULT_THRESHOLD_USD must be a positive decimal');
    }
    expect(() => new AlertsService(store, prices, metadata, new ConfigService({ WHALE_DEFAULT_THRESHOLD_USD: 100000 })))
      .not.toThrow();
  });

  it('validates rule requirements after merging a PATCH with the locked current rule', async () => {
    await expect(service.create(owner, { type: 'price_above' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(owner, { type: 'wallet_activity' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(owner, id, { type: 'wallet_activity', walletAddress: wallet })).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.update(owner, id, { type: 'wallet_activity', walletAddress: wallet, thresholdUsd: null })).toMatchObject({ type: 'wallet_activity', thresholdUsd: null });
    await expect(service.update(owner, id, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('evaluates exact whale transfer USD values without any holdings lookup', async () => {
    await service.evaluateTransfer(transfer());
    expect(metadata.decimals).not.toHaveBeenCalled();
    expect(prices.getPrice).toHaveBeenCalledWith(`erc20:${token}`);
    expect(inserted).toHaveLength(2);
    expect(inserted.find((entry) => entry.alertId === id)?.event.payload).toMatchObject({
      amountFormatted: '100000.000000000000000001', valueUsd: '100000.000000000000000001',
      priceFetchedAt: price.fetchedAt, valuationBasis: 'current_price', decimals: 18,
    });
  });

  it('commits wallet activity independently while missing whale pricing causes a retry', async () => {
    prices.getPrice = vi.fn<PricesService['getPrice']>().mockResolvedValue({ ...price, availability: 'unavailable', priceUsd: null, fetchedAt: null });
    await expect(service.evaluateTransfer(transfer())).rejects.toThrow('Fresh token price unavailable');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.alertId).toBe(activity.id);
    expect(inserted[0]?.event.payload.valueUsd).toBeNull();
  });

  it('does not use stale whale pricing', async () => {
    prices.getPrice = vi.fn<PricesService['getPrice']>().mockResolvedValue({ ...price, stale: true });
    await expect(service.evaluateTransfer(transfer())).rejects.toThrow('Fresh token price unavailable');
    expect(inserted).toHaveLength(1);
  });

  it('uses RPC decimals for legacy v1 transfers instead of assuming 18', async () => {
    await service.evaluateTransfer(transfer({ tokenDecimals: undefined }));
    expect(metadata.decimals).toHaveBeenCalledWith(token, 9007199254740993n);
  });

  it('uses one stable idempotency key even when the same log is reindexed with a new event ID', async () => {
    await service.evaluateTransfer(transfer());
    await service.evaluateTransfer(transfer());
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.key).toBe(`transfer:11155111:0x${'1'.repeat(64)}:2`);
  });

  it('does not evaluate transfers on another configured chain', async () => {
    await service.evaluateTransfer(transfer({ chainId: 1 }));
    expect(store.transferRules).not.toHaveBeenCalled();
    expect(prices.getPrice).not.toHaveBeenCalled();
  });

  it('rechecks disabled and changed wallet filters under the repository rule lock', async () => {
    rules = [{ ...whale, enabled: false }, { ...activity, walletAddress: `0x${'d'.repeat(40)}` }];
    await service.evaluateTransfer(transfer());
    expect(inserted).toHaveLength(0);
  });

  it('registers the fresh-price listener and unsubscribes during shutdown', async () => {
    let listener: ((value: AssetPriceResponse) => Promise<void>) | undefined;
    const unsubscribe = vi.fn();
    prices.subscribe = vi.fn<PricesService['subscribe']>().mockImplementation((handler) => { listener = handler; return unsubscribe; });
    service.onModuleInit();
    if (!listener) throw new Error('Expected price subscription');
    await listener(price);
    expect(store.evaluatePrice).toHaveBeenCalledWith(price);
    service.onModuleDestroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('Alert DTO decimal/security contracts', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it.each(['0', '-1', '1e5', '0.0000000000000000001', '1.' , '9'.repeat(61), 100])('rejects invalid threshold %s', async (thresholdUsd) => {
    await expect(pipe.transform({ userId: owner, type: 'price_above', thresholdUsd }, { type: 'body', metatype: CreateAlertDto }))
      .rejects.toMatchObject({ status: 400 });
  });
  it('accepts exact subcent thresholds and rejects spoofed update ownership', async () => {
    expect(await pipe.transform({ userId: owner, type: 'price_below', thresholdUsd: '0.000000000000000001' }, {
      type: 'body', metatype: CreateAlertDto,
    })).toMatchObject({ thresholdUsd: '0.000000000000000001' });
    await expect(pipe.transform({ enabled: false, userId: foreign }, { type: 'body', metatype: UpdateAlertDto })).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ enabled: null }, { type: 'body', metatype: UpdateAlertDto })).rejects.toMatchObject({ status: 400 });
  });
});
