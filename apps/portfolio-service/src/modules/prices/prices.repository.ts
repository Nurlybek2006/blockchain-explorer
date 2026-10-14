import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { isAssetKey, isEthereumAddress } from '@blockchain-explorer/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { alerts, holdings, portfolios, prices, priceSnapshots, watchlistItems } from '../../database/schema/index.js';
import type { CoinGeckoPrice } from './coingecko.client.js';

export type PriceRecord = typeof prices.$inferSelect;
export interface StorePriceInput extends CoinGeckoPrice {
  assetKey: string;
  tokenAddress: string | null;
  coinGeckoId: string | null;
  symbol: string | null;
}

@Injectable()
export class PricesRepository {
  constructor(@Inject(DatabaseService) private readonly database: Pick<DatabaseService, 'db'>) {}

  async find(assetKey: string): Promise<PriceRecord | null> {
    const [price] = await this.database.db.select().from(prices).where(eq(prices.assetKey, assetKey)).limit(1);
    return price ?? null;
  }

  async findMany(assetKeys: readonly string[]): Promise<PriceRecord[]> {
    if (assetKeys.length === 0) return [];
    return this.database.db.select().from(prices).where(inArray(prices.assetKey, [...assetKeys]));
  }

  async findSymbol(assetKey: string): Promise<string | null> {
    if (assetKey === 'native:eth') return 'ETH';
    const [holding] = await this.database.db.select({ symbol: holdings.symbol }).from(holdings)
      .innerJoin(portfolios, eq(holdings.portfolioId, portfolios.id))
      .where(and(eq(holdings.assetKey, assetKey), isNull(portfolios.archivedAt)))
      .orderBy(asc(holdings.id)).limit(1);
    return holding?.symbol ?? null;
  }

  async save(input: StorePriceInput): Promise<PriceRecord> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'price:' + input.assetKey}, 0))`);
      const [current] = await transaction.select().from(prices).where(eq(prices.assetKey, input.assetKey)).limit(1);
      if (current && current.fetchedAt.getTime() > input.fetchedAt.getTime()) return current;

      const values = {
        assetKey: input.assetKey,
        tokenAddress: input.tokenAddress,
        coinGeckoId: input.coinGeckoId,
        symbol: input.symbol ?? current?.symbol ?? 'UNKNOWN',
        usdPrice: input.priceUsd,
        change24hPercent: input.change24hPercent,
        marketCapUsd: input.marketCapUsd,
        fetchedAt: input.fetchedAt,
      };
      const [saved] = await transaction.insert(prices).values(values)
        .onConflictDoUpdate({ target: prices.assetKey, set: values }).returning();
      if (!saved) throw new Error('Price upsert returned no row');

      // A provider may return the same cached observation on repeated requests.
      if (!current || current.fetchedAt.getTime() !== input.fetchedAt.getTime() || current.usdPrice !== saved.usdPrice) {
        await transaction.insert(priceSnapshots).values({
          assetKey: input.assetKey, usdPrice: saved.usdPrice, recordedAt: input.fetchedAt,
        });
      }
      return saved;
    });
  }

  async markUnavailable(assetKey: string, observedAt: Date, previous: PriceRecord | null): Promise<PriceRecord | null> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'price:' + assetKey}, 0))`);
      if (previous) {
        // Delete only the observation read before the provider request. Another
        // instance may already have published a newer source timestamp or price.
        await transaction.delete(prices).where(and(
          eq(prices.assetKey, assetKey), lte(prices.fetchedAt, observedAt),
          eq(prices.fetchedAt, previous.fetchedAt), eq(prices.usdPrice, previous.usdPrice),
        ));
      }
      const [remaining] = await transaction.select().from(prices).where(eq(prices.assetKey, assetKey)).limit(1);
      return remaining ?? null;
    });
  }

  async getActiveAssetKeys(): Promise<string[]> {
    const [trackedHoldings, watchedTokens, alertTokens] = await Promise.all([
      this.database.db.selectDistinct({ assetKey: holdings.assetKey }).from(holdings)
        .innerJoin(portfolios, eq(holdings.portfolioId, portfolios.id)).where(isNull(portfolios.archivedAt)),
      this.database.db.selectDistinct({ address: watchlistItems.address }).from(watchlistItems)
        .where(eq(watchlistItems.itemType, 'token')),
      this.database.db.selectDistinct({ tokenAddress: alerts.tokenAddress }).from(alerts).where(eq(alerts.enabled, true)),
    ]);
    const keys = new Set<string>(['native:eth']);
    for (const { assetKey } of trackedHoldings) if (isAssetKey(assetKey)) keys.add(assetKey);
    for (const { address } of watchedTokens) if (isEthereumAddress(address)) keys.add(`erc20:${address.toLowerCase()}`);
    for (const { tokenAddress } of alertTokens) if (isEthereumAddress(tokenAddress)) keys.add(`erc20:${tokenAddress.toLowerCase()}`);
    return [...keys].sort();
  }
}
