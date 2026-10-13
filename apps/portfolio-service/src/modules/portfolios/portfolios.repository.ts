import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { holdings, outboxEvents, portfolios } from '../../database/schema/index.js';
import { isUniqueViolation } from '../../common/utils/postgres-error.js';
import { activeOwnedPortfolio } from './portfolio-ownership.js';
import { INITIAL_SYNC_EVENT_TYPE } from './portfolio-initial-sync.js';

export type PortfolioRecord = typeof portfolios.$inferSelect;
export type HoldingRecord = typeof holdings.$inferSelect;

export interface CreatePortfolioRecord {
  userId: string;
  name: string;
  walletAddress: string;
  chainId: number;
}

@Injectable()
export class PortfoliosRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'db'>,
  ) {}

  async create(input: CreatePortfolioRecord): Promise<PortfolioRecord> {
    try {
      return await this.database.db.transaction(async (transaction) => {
        // There might be no portfolio row to lock yet. Serialize all creates and
        // archives for a user so concurrent first creates cannot both be primary.
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}::uuid::text, 0))`);

        const [duplicate] = await transaction.select({ id: portfolios.id })
          .from(portfolios)
          .where(and(
            eq(portfolios.userId, input.userId),
            eq(portfolios.chainId, input.chainId),
            sql`lower(${portfolios.walletAddress}) = ${input.walletAddress}`,
          ))
          .limit(1);
        if (duplicate) {
          throw new ConflictException('A portfolio for this wallet and chain already exists');
        }

        const [active] = await transaction.select({ id: portfolios.id })
          .from(portfolios)
          .where(activeOwnedPortfolio(input.userId))
          .limit(1);
        const [portfolio] = await transaction.insert(portfolios)
          .values({ ...input, isPrimary: active === undefined })
          .returning();
        if (!portfolio) {
          throw new Error('Portfolio insert returned no row');
        }

        // This intent survives process crashes and Redis outages after commit.
        await transaction.insert(outboxEvents).values({
          eventType: INITIAL_SYNC_EVENT_TYPE,
          aggregateType: 'portfolio',
          aggregateId: portfolio.id,
          payload: { portfolioId: portfolio.id, chainId: portfolio.chainId },
        });
        return portfolio;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'portfolios_user_wallet_chain_uq')) {
        throw new ConflictException('A portfolio for this wallet and chain already exists');
      }
      throw error;
    }
  }

  async listOwned(userId: string, page: number, limit: number): Promise<{
    items: PortfolioRecord[];
    total: number;
  }> {
    return this.database.db.transaction(async (transaction) => {
      const [result] = await transaction.select({ total: count() })
        .from(portfolios)
        .where(activeOwnedPortfolio(userId));
      const items = await transaction.select().from(portfolios)
        .where(activeOwnedPortfolio(userId))
        .orderBy(desc(portfolios.isPrimary), desc(portfolios.createdAt), asc(portfolios.id))
        .limit(limit)
        .offset((page - 1) * limit);
      return { items, total: result?.total ?? 0 };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async findOwned(userId: string, id: string): Promise<PortfolioRecord | null> {
    const [portfolio] = await this.database.db.select().from(portfolios)
      .where(activeOwnedPortfolio(userId, id))
      .limit(1);
    return portfolio ?? null;
  }

  async listOwnedHoldings(userId: string, id: string): Promise<HoldingRecord[]> {
    const rows = await this.database.db.select({ holding: holdings })
      .from(holdings)
      .innerJoin(portfolios, eq(holdings.portfolioId, portfolios.id))
      .where(activeOwnedPortfolio(userId, id))
      .orderBy(asc(holdings.assetKey));
    return rows.map((row) => row.holding);
  }

  async renameOwned(userId: string, id: string, name: string): Promise<PortfolioRecord | null> {
    const [portfolio] = await this.database.db.update(portfolios)
      .set({ name, updatedAt: new Date() })
      .where(activeOwnedPortfolio(userId, id))
      .returning();
    return portfolio ?? null;
  }

  async archiveOwned(userId: string, id: string): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}::uuid::text, 0))`);
      const [current] = await transaction.select().from(portfolios)
        .where(activeOwnedPortfolio(userId, id))
        .limit(1);
      if (!current) {
        return false;
      }

      const now = new Date();
      await transaction.update(portfolios)
        .set({ archivedAt: now, isPrimary: false, updatedAt: now })
        .where(activeOwnedPortfolio(userId, id));

      if (current.isPrimary) {
        const [next] = await transaction.select({ id: portfolios.id })
          .from(portfolios)
          .where(activeOwnedPortfolio(userId))
          .orderBy(asc(portfolios.createdAt), asc(portfolios.id))
          .limit(1);
        if (next) {
          await transaction.update(portfolios)
            .set({ isPrimary: true, updatedAt: now })
            .where(activeOwnedPortfolio(userId, next.id));
        }
      }
      return true;
    });
  }
}
