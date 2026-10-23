import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { PortfolioTradeInput } from '@blockchain-explorer/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { holdings, portfolios, portfolioTrades } from '../../database/schema/index.js';
import { activeOwnedPortfolio } from '../portfolios/portfolio-ownership.js';
import { FinanceDecimal } from '../../common/utils/decimal-math.js';
import { isUniqueViolation } from '../../common/utils/postgres-error.js';
import type { PortfolioState } from './analytics.repository.js';
import { replayTrades, TradeHistoryError, type OrderedTrade } from './pnl.math.js';

export type TradeRecord = typeof portfolioTrades.$inferSelect;
export function orderedTrade(row: TradeRecord): OrderedTrade {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}
function sameInput(row: TradeRecord, input: PortfolioTradeInput): boolean {
  return row.clientId === input.clientId && row.assetKey === input.assetKey && row.symbol === input.symbol && row.decimals === input.decimals
    && row.side === input.side && row.quantityRaw === input.quantityRaw && row.activityId === input.activityId
    && row.transactionHash === input.transactionHash && row.occurredAt.getTime() === Date.parse(input.occurredAt)
    && new FinanceDecimal(row.feeUsd).eq(input.feeUsd)
    && (row.unitPriceUsd === null ? input.unitPriceUsd === null : input.unitPriceUsd !== null && new FinanceDecimal(row.unitPriceUsd).eq(input.unitPriceUsd));
}

@Injectable()
export class TradesRepository {
  constructor(@Inject(DatabaseService) private readonly database: Pick<DatabaseService, 'db'>) {}

  snapshotOwned(userId: string, id: string): Promise<{ state: PortfolioState; entries: TradeRecord[] } | null> {
    return this.database.db.transaction(async tx => {
      const [portfolio] = await tx.select().from(portfolios).where(activeOwnedPortfolio(userId, id)).limit(1);
      if (!portfolio) return null;
      const rows = await tx.select().from(holdings).where(eq(holdings.portfolioId, id)).orderBy(asc(holdings.assetKey));
      const entries = await tx.select().from(portfolioTrades).where(eq(portfolioTrades.portfolioId, id))
        .orderBy(asc(portfolioTrades.occurredAt), asc(portfolioTrades.sequence));
      return { state: { portfolio, holdings: rows }, entries };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async writeOwned(userId: string, id: string, input: PortfolioTradeInput | null, entryId?: string): Promise<TradeRecord | null> {
    try {
      return await this.database.db.transaction(async tx => {
        // Serializes replays, idempotent retries and archive operations for one portfolio.
        const [portfolio] = await tx.select({ id: portfolios.id }).from(portfolios).where(activeOwnedPortfolio(userId, id)).for('update').limit(1);
        if (!portfolio) throw new NotFoundException('Portfolio not found');
        const rows = await tx.select().from(portfolioTrades).where(eq(portfolioTrades.portfolioId, id))
          .orderBy(asc(portfolioTrades.occurredAt), asc(portfolioTrades.sequence));
        const existing = entryId ? rows.find(row => row.id === entryId.toLowerCase()) : input ? rows.find(row => row.clientId === input.clientId) : undefined;
        if (entryId && !existing) throw new NotFoundException('Trade not found');
        if (input && existing && !entryId) {
          if (!sameInput(existing, input)) throw new ConflictException('Idempotency key already used');
          return existing;
        }
        if (input && existing && input.clientId !== existing.clientId) throw new BadRequestException('Trade clientId cannot change');
        if (input && !existing && rows.length >= 10_000) throw new BadRequestException('Trade journal limit reached');
        if (input) {
          const [holding] = await tx.select().from(holdings).where(and(eq(holdings.portfolioId, id), eq(holdings.assetKey, input.assetKey))).limit(1);
          if (holding && holding.decimals !== input.decimals) throw new BadRequestException('Asset decimals do not match the holding');
        }
        const replay = rows.filter(row => row.id !== existing?.id).map(orderedTrade);
        const sequence = existing?.sequence ?? ((rows.reduce((max, row) => row.sequence > max ? row.sequence : max, 0n)) + 1n);
        if (input) replay.push({ ...input, sequence });
        replayTrades(replay);
        if (!input) {
          if (!existing) throw new NotFoundException('Trade not found');
          await tx.delete(portfolioTrades).where(and(eq(portfolioTrades.id, existing.id), eq(portfolioTrades.portfolioId, id)));
          return null;
        }
        const values = { ...input, occurredAt: new Date(input.occurredAt) };
        const [saved] = existing
          ? await tx.update(portfolioTrades).set(values).where(and(eq(portfolioTrades.id, existing.id), eq(portfolioTrades.portfolioId, id))).returning()
          : await tx.insert(portfolioTrades).values({ ...values, portfolioId: id }).returning();
        if (!saved) throw new Error('Trade write returned no row');
        return saved;
      });
    } catch (error: unknown) {
      if (error instanceof TradeHistoryError) throw new BadRequestException(error.message);
      if (isUniqueViolation(error, 'portfolio_trades_client_uq') || isUniqueViolation(error, 'portfolio_trades_activity_uq')) {
        throw new ConflictException('Trade or activity already recorded');
      }
      throw error;
    }
  }
}
