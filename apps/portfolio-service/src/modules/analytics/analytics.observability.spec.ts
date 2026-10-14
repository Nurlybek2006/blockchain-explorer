import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as telemetry from '@blockchain-explorer/observability';
import { AnalyticsService } from './analytics.service.js';
import type { AnalyticsRepository } from './analytics.repository.js';
import type { PricesService } from '../prices/prices.service.js';
import { holding, price, state, testOwner, testPortfolioId } from './analytics.fixtures.js';

vi.mock('@blockchain-explorer/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blockchain-explorer/observability')>();
  return { ...actual, recordCounter: vi.fn(), recordGauge: vi.fn(), recordHistogram: vi.fn(), withSpan: vi.fn(actual.withSpan) };
});

describe('portfolio business metric correctness', () => {
  let repository: AnalyticsRepository;
  let prices: Pick<PricesService, 'getPrices' | 'getPrice'>;
  let service: AnalyticsService;
  beforeEach(() => {
    vi.clearAllMocks();
    repository = {
      ownedState: vi.fn<AnalyticsRepository['ownedState']>().mockResolvedValue(state([holding('native:eth', '1000000000000000000')])),
      activeState: vi.fn<AnalyticsRepository['activeState']>().mockResolvedValue(state([holding('native:eth', '1000000000000000000')])),
      activePortfolioIds: vi.fn<AnalyticsRepository['activePortfolioIds']>().mockResolvedValue([testPortfolioId]),
      ownedHistory: vi.fn<AnalyticsRepository['ownedHistory']>().mockResolvedValue([]),
      ownedHistoricalBaseline: vi.fn<AnalyticsRepository['ownedHistoricalBaseline']>().mockResolvedValue(null),
      insertSnapshotIfAbsent: vi.fn<AnalyticsRepository['insertSnapshotIfAbsent']>().mockResolvedValue(true),
    };
    prices = {
      getPrices: vi.fn<PricesService['getPrices']>().mockResolvedValue([price('native:eth', '1200')]),
      getPrice: vi.fn<PricesService['getPrice']>().mockResolvedValue(price('native:eth', '1200')),
    };
    service = new AnalyticsService(repository, prices, new ConfigService());
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('counts completed valuations and exposes the latest unpriced count without identity labels', async () => {
    vi.mocked(prices.getPrices).mockResolvedValue([price('native:eth', null)]);
    const result = await service.valuation(testOwner, testPortfolioId);
    expect(result.summary.complete).toBe(false);
    expect(telemetry.recordCounter).toHaveBeenCalledWith('portfolio_valuations_total');
    expect(telemetry.recordGauge).toHaveBeenCalledWith('portfolio_unpriced_assets', 1);
    expect(telemetry.recordHistogram).toHaveBeenCalledWith('portfolio_valuation_duration_seconds', expect.any(Number), { status: 'success' });
    expect(vi.mocked(telemetry.withSpan).mock.calls[0]?.slice(0, 2)).toEqual(['portfolio.valuation', {}]);
  });

  it('counts only inserted snapshots, excluding an existing bucket and skipped observations', async () => {
    vi.mocked(repository.insertSnapshotIfAbsent).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await service.snapshotPortfolio(testPortfolioId);
    await service.snapshotPortfolio(testPortfolioId);
    vi.mocked(prices.getPrices).mockResolvedValue([price('native:eth', null)]);
    await service.snapshotPortfolio(testPortfolioId);
    expect(vi.mocked(telemetry.recordCounter).mock.calls.filter(([name]) => name === 'portfolio_snapshots_total')).toHaveLength(1);
  });

  it('does not count a snapshot transaction that rolls back', async () => {
    const failure = new Error('Snapshot transaction rolled back');
    vi.mocked(repository.insertSnapshotIfAbsent).mockRejectedValue(failure);
    await expect(service.snapshotPortfolio(testPortfolioId)).rejects.toBe(failure);
    expect(vi.mocked(telemetry.recordCounter).mock.calls.some(([name]) => name === 'portfolio_snapshots_total')).toBe(false);
  });

  it('preserves valuation failures and reports failure duration without a successful counter', async () => {
    const failure = new Error('Pricing read failed');
    vi.mocked(prices.getPrices).mockRejectedValue(failure);
    await expect(service.valuation(testOwner, testPortfolioId)).rejects.toBe(failure);
    expect(telemetry.recordCounter).not.toHaveBeenCalled();
    expect(telemetry.recordGauge).not.toHaveBeenCalled();
    expect(telemetry.recordHistogram).toHaveBeenCalledWith('portfolio_valuation_duration_seconds', expect.any(Number), { status: 'error' });
  });
});
