import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PortfolioAnalyticsResponse, PortfolioHistoryRange, PortfolioHistoryResponse, PortfolioValuationResponse,
} from '@blockchain-explorer/contracts';
import { FinanceDecimal, toMoney } from '../../common/utils/decimal-math.js';
import { PricesService } from '../prices/prices.service.js';
import { AnalyticsRepository } from './analytics.repository.js';
import type { PortfolioState } from './analytics.repository.js';
import { buildAnalytics, buildValuation } from './valuation.math.js';

const historyMilliseconds: Record<PortfolioHistoryRange, number> = {
  '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, '90d': 90 * 86_400_000,
};

function hasObservedNativeBalance(state: PortfolioState): boolean {
  return state.holdings.some((holding) => holding.assetKey === 'native:eth'
    && holding.assetType === 'native' && holding.decimals === 18 && holding.lastUpdatedBlock !== null);
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly snapshotIntervalMs: number;

  constructor(
    private readonly repository: AnalyticsRepository,
    @Inject(PricesService) private readonly prices: Pick<PricesService, 'getPrices' | 'getPrice'>,
    config: ConfigService,
  ) {
    this.snapshotIntervalMs = Number(config.get<string | number>('PORTFOLIO_SNAPSHOT_INTERVAL_MS') ?? 300_000);
    if (!Number.isSafeInteger(this.snapshotIntervalMs) || this.snapshotIntervalMs < 60_000 || this.snapshotIntervalMs > 86_400_000) {
      throw new Error('PORTFOLIO_SNAPSHOT_INTERVAL_MS must be an integer between 60000 and 86400000');
    }
  }

  async valuation(userId: string, portfolioId: string): Promise<PortfolioValuationResponse> {
    return this.valueState(await this.requireOwnedState(userId, portfolioId));
  }

  async history(userId: string, portfolioId: string, range: PortfolioHistoryRange = '7d', limit = 100): Promise<PortfolioHistoryResponse> {
    if (!Object.hasOwn(historyMilliseconds, range) || !Number.isSafeInteger(limit) || limit < 2 || limit > 1000) {
      throw new BadRequestException('Invalid portfolio history range or limit');
    }
    await this.requireOwnedState(userId, portfolioId);
    const now = new Date();
    const points = await this.repository.ownedHistory(userId, portfolioId, new Date(now.getTime() - historyMilliseconds[range]), now, limit);
    return { range, points: points.map((point) => ({ timestamp: point.recordedAt.toISOString(), valueUsd: toMoney(point.totalValueUsd, 2) })) };
  }

  async analytics(userId: string, portfolioId: string): Promise<PortfolioAnalyticsResponse> {
    const valuation = await this.valuation(userId, portfolioId);
    const cutoff = new Date(Date.now() - 86_400_000);
    // An older arbitrary snapshot must not masquerade as a 24h comparison.
    const baseline = await this.repository.ownedHistoricalBaseline(userId, portfolioId,
      new Date(cutoff.getTime() - this.snapshotIntervalMs), cutoff);
    return buildAnalytics(valuation, baseline?.totalValueUsd ?? null);
  }

  async snapshotPortfolio(portfolioId: string): Promise<void> {
    const state = await this.repository.activeState(portfolioId);
    if (!state) return;
    if (!hasObservedNativeBalance(state)) {
      this.logger.warn(`Snapshot skipped for portfolio ${portfolioId}: native wallet balance has not been observed`);
      return;
    }
    const valuation = await this.valueState(state);
    if (!valuation.summary.complete || valuation.summary.totalValueUsd === null) {
      this.logger.warn(`Snapshot skipped for portfolio ${portfolioId}: nonzero holdings have unavailable prices`);
      return;
    }
    if (valuation.summary.staleAssetCount > 0) {
      this.logger.warn(`Snapshot skipped for portfolio ${portfolioId}: stale prices cannot represent a current history observation`);
      return;
    }
    const total = new FinanceDecimal(valuation.summary.totalValueUsd);
    const ethPrice = await this.prices.getPrice('native:eth');
    const nativePrice = ethPrice.availability === 'available' && ethPrice.priceUsd !== null
      ? new FinanceDecimal(ethPrice.priceUsd) : null;
    const allBalancesZero = state.holdings.every((holding) => new FinanceDecimal(holding.balanceRaw).isZero());
    const ethValue = allBalancesZero ? new FinanceDecimal(0)
      : nativePrice !== null && nativePrice.isFinite() && nativePrice.gt(0) && !ethPrice.stale ? total.div(nativePrice) : null;
    // Existing PostgreSQL numeric sizes are part of the storage contract.
    if (new FinanceDecimal(toMoney(total, 2)).gte('1e36') || (ethValue !== null && new FinanceDecimal(toMoney(ethValue)).gte('1e20'))) {
      this.logger.warn(`Snapshot skipped for portfolio ${portfolioId}: valuation exceeds existing numeric storage precision`);
      return;
    }
    const recordedAt = new Date();
    const start = Math.floor(recordedAt.getTime() / this.snapshotIntervalMs) * this.snapshotIntervalMs;
    await this.repository.insertSnapshotIfAbsent({
      portfolioId, totalValueUsd: toMoney(total, 2), totalValueEth: ethValue === null ? null : toMoney(ethValue),
      recordedAt, bucketStart: new Date(start), bucketEnd: new Date(start + this.snapshotIntervalMs),
    });
  }

  async refreshPortfolioValuations(): Promise<void> {
    const ids = await this.repository.activePortfolioIds();
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const state = await this.repository.activeState(id);
        if (state) await this.valueState(state);
      } catch (error: unknown) {
        failures.push(id);
        this.logger.error(`Portfolio valuation refresh failed for ${id}`, error instanceof Error ? error.stack : undefined);
      }
    }
    if (failures.length > 0) throw new Error(`Portfolio valuation refresh failed for ${failures.length} portfolios`);
  }

  private async requireOwnedState(userId: string, portfolioId: string): Promise<PortfolioState> {
    const state = await this.repository.ownedState(userId, portfolioId);
    if (!state) throw new NotFoundException('Portfolio not found');
    return state;
  }

  private async valueState(state: PortfolioState): Promise<PortfolioValuationResponse> {
    const keys = [...new Set(state.holdings.map((holding) => holding.assetKey))];
    const prices = await this.prices.getPrices(keys);
    const valuation = buildValuation(state, new Map(prices.map((price) => [price.assetKey, price])));
    if (!hasObservedNativeBalance(state)) {
      // Initial-sync absence is missing blockchain data, not proof that a wallet is empty.
      valuation.summary.complete = false;
      valuation.summary.totalValueUsd = null;
      valuation.summary.marketChangeComplete = false;
      valuation.summary.change24hUsd = null;
      valuation.summary.change24hPercent = null;
    }
    return valuation;
  }
}
