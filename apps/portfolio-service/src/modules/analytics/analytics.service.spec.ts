import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PricesService } from '../prices/prices.service.js';
import type { AnalyticsRepository } from './analytics.repository.js';
import { AnalyticsService } from './analytics.service.js';
import { PortfolioHistoryQueryDto } from './dto/analytics-query.dto.js';
import { holding, price, state, testDate, testOwner, testPortfolioId } from './analytics.fixtures.js';

describe('AnalyticsService ownership, history and snapshots', () => {
  let repository: AnalyticsRepository;
  let prices: Pick<PricesService, 'getPrices' | 'getPrice'>;
  let service: AnalyticsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(testDate);
    repository = {
      ownedState: vi.fn<AnalyticsRepository['ownedState']>().mockResolvedValue(state([holding('native:eth', '1000000000000000000')])),
      activeState: vi.fn<AnalyticsRepository['activeState']>().mockResolvedValue(state([holding('native:eth', '1000000000000000000')])),
      activePortfolioIds: vi.fn<AnalyticsRepository['activePortfolioIds']>().mockResolvedValue([testPortfolioId]),
      ownedHistory: vi.fn<AnalyticsRepository['ownedHistory']>().mockResolvedValue([]),
      ownedHistoricalBaseline: vi.fn<AnalyticsRepository['ownedHistoricalBaseline']>().mockResolvedValue(null),
      insertSnapshotIfAbsent: vi.fn<AnalyticsRepository['insertSnapshotIfAbsent']>().mockResolvedValue(true),
    };
    prices = {
      getPrices: vi.fn<PricesService['getPrices']>().mockResolvedValue([price('native:eth', '1234.56789')]),
      getPrice: vi.fn<PricesService['getPrice']>().mockResolvedValue(price('native:eth', '1234.56789')),
    };
    service = new AnalyticsService(repository, prices, new ConfigService());
  });
  afterEach(() => { vi.useRealTimers(); });

  it('rejects foreign or archived IDs before pricing or snapshot history reads', async () => {
    vi.mocked(repository.ownedState).mockResolvedValue(null);
    for (const action of [service.valuation('foreign', testPortfolioId), service.analytics('foreign', testPortfolioId), service.history('foreign', testPortfolioId)]) {
      await expect(action).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(prices.getPrices).not.toHaveBeenCalled();
    expect(repository.ownedHistory).not.toHaveBeenCalled();
    expect(repository.ownedHistoricalBaseline).not.toHaveBeenCalled();
  });

  it('passes the owner and bounded entire history range to the repository and preserves decimal strings', async () => {
    const first = new Date('2026-10-01T00:00:00Z');
    vi.mocked(repository.ownedHistory).mockResolvedValue([{
      id: testPortfolioId, portfolioId: testPortfolioId, totalValueUsd: '9007199254740993.25', totalValueEth: null, recordedAt: first,
    }, { id: testPortfolioId, portfolioId: testPortfolioId, totalValueUsd: '9007199254740993.26', totalValueEth: null, recordedAt: testDate }]);
    expect(await service.history(testOwner, testPortfolioId, '30d', 2)).toEqual({ range: '30d', points: [
      { timestamp: first.toISOString(), valueUsd: '9007199254740993.25' },
      { timestamp: testDate.toISOString(), valueUsd: '9007199254740993.26' },
    ] });
    expect(repository.ownedHistory).toHaveBeenCalledWith(testOwner, testPortfolioId,
      new Date(testDate.getTime() - 30 * 86_400_000), testDate, 2);
    await expect(service.history(testOwner, testPortfolioId, '7d', 1001)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only uses a baseline near 24h ago, rather than presenting an arbitrary old snapshot as 24h', async () => {
    await service.analytics(testOwner, testPortfolioId);
    const cutoff = testDate.getTime() - 86_400_000;
    expect(repository.ownedHistoricalBaseline).toHaveBeenCalledWith(testOwner, testPortfolioId, new Date(cutoff - 300_000), new Date(cutoff));
  });

  it('writes cents and exact ETH within a stable interval bucket and delegates transactional duplicate control', async () => {
    await Promise.all([service.snapshotPortfolio(testPortfolioId), service.snapshotPortfolio(testPortfolioId)]);
    const args = vi.mocked(repository.insertSnapshotIfAbsent).mock.calls;
    expect(args).toHaveLength(2);
    expect(args[0]?.[0]).toEqual({
      portfolioId: testPortfolioId, totalValueUsd: '1234.57', totalValueEth: '1', recordedAt: testDate,
      bucketStart: new Date('2026-10-14T08:00:00Z'), bucketEnd: new Date('2026-10-14T08:05:00Z'),
    });
    expect(args[1]?.[0].bucketStart).toEqual(args[0]?.[0].bucketStart);
  });

  it('skips incomplete nonzero valuations and archived portfolios but can snapshot actual zero', async () => {
    vi.mocked(prices.getPrices).mockResolvedValue([price('native:eth', null)]);
    await service.snapshotPortfolio(testPortfolioId);
    expect(repository.insertSnapshotIfAbsent).not.toHaveBeenCalled();
    vi.mocked(repository.activeState).mockResolvedValue(state([holding('native:eth', '0')]));
    await service.snapshotPortfolio(testPortfolioId);
    expect(repository.insertSnapshotIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ totalValueUsd: '0', totalValueEth: '0' }));
    vi.mocked(repository.activeState).mockResolvedValue(null);
    await service.snapshotPortfolio(testPortfolioId);
    expect(repository.insertSnapshotIfAbsent).toHaveBeenCalledOnce();
  });

  it('never overflows existing snapshot numeric columns', async () => {
    vi.mocked(repository.activeState).mockResolvedValue(state([holding('native:eth', `1${'0'.repeat(70)}`)]));
    await service.snapshotPortfolio(testPortfolioId);
    expect(repository.insertSnapshotIfAbsent).not.toHaveBeenCalled();
  });

  it('does not timestamp stale market prices as a fresh portfolio history observation', async () => {
    vi.mocked(prices.getPrices).mockResolvedValue([price('native:eth', '1234', '0', true)]);
    await service.snapshotPortfolio(testPortfolioId);
    expect(repository.insertSnapshotIfAbsent).not.toHaveBeenCalled();
  });

  it('does not represent zero USD from a zero asset price as a known zero ETH balance', async () => {
    vi.mocked(prices.getPrices).mockResolvedValue([price('native:eth', '0')]);
    for (const ethPrice of [price('native:eth', '0'), price('native:eth', null)]) {
      vi.mocked(prices.getPrice).mockResolvedValue(ethPrice);
      await service.snapshotPortfolio(testPortfolioId);
    }
    const inserts = vi.mocked(repository.insertSnapshotIfAbsent).mock.calls;
    expect(inserts).toHaveLength(2);
    expect(inserts.every(([input]) => input.totalValueUsd === '0' && input.totalValueEth === null)).toBe(true);
  });

  it('does not report or snapshot an unsynced wallet as a known zero portfolio', async () => {
    const unobserved = { ...holding('native:eth', '0'), lastUpdatedBlock: null };
    for (const items of [[], [holding('unknown-token', '0')], [unobserved]]) {
      vi.mocked(repository.ownedState).mockResolvedValue(state(items));
      vi.mocked(repository.activeState).mockResolvedValue(state(items));
      const valuation = await service.valuation(testOwner, testPortfolioId);
      expect(valuation.summary).toMatchObject({ complete: false, totalValueUsd: null, marketChangeComplete: false, change24hUsd: null });
      await service.snapshotPortfolio(testPortfolioId);
    }
    expect(repository.insertSnapshotIfAbsent).not.toHaveBeenCalled();
  });

  it('refreshes all active portfolios and reports failures after attempting the remaining ones', async () => {
    vi.mocked(repository.activePortfolioIds).mockResolvedValue(['first', 'second']);
    vi.mocked(repository.activeState).mockRejectedValueOnce(new Error('Read failed'));
    await expect(service.refreshPortfolioValuations()).rejects.toThrow('1 portfolios');
    expect(repository.activeState).toHaveBeenCalledWith('second');
    expect(prices.getPrices).toHaveBeenCalledOnce();
  });

  it('validates history DTO owner, supported ranges and lower/upper point bounds', async () => {
    expect(await validate(plainToInstance(PortfolioHistoryQueryDto, { userId: testOwner, range: '90d', limit: '1000' }))).toHaveLength(0);
    for (const input of [{ userId: 'bad' }, { userId: testOwner, range: '1y' }, { userId: testOwner, limit: 1 }, { userId: testOwner, limit: 1001 }]) {
      expect((await validate(plainToInstance(PortfolioHistoryQueryDto, input))).length).toBeGreaterThan(0);
    }
  });
});
