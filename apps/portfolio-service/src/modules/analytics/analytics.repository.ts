import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { holdings, portfolios, portfolioSnapshots } from '../../database/schema/index.js';
import { activeOwnedPortfolio } from '../portfolios/portfolio-ownership.js';

export type AnalyticsPortfolio = typeof portfolios.$inferSelect;
export type AnalyticsHolding = typeof holdings.$inferSelect;
export type AnalyticsSnapshot = typeof portfolioSnapshots.$inferSelect;
export interface PortfolioState { portfolio: AnalyticsPortfolio; holdings: AnalyticsHolding[] }
export interface SnapshotInsert {
  portfolioId: string;
  totalValueUsd: string;
  totalValueEth: string | null;
  recordedAt: Date;
  bucketStart: Date;
  bucketEnd: Date;
}

/** Raw PostgreSQL SQL results bypass Drizzle column decoders, including timestamptz. */
export function decodeHistorySnapshotRow(row: Record<string, unknown>): AnalyticsSnapshot {
  const { id, portfolioId, totalValueUsd, totalValueEth, recordedAt } = row;
  if (typeof id !== 'string' || typeof portfolioId !== 'string'
    || typeof totalValueUsd !== 'string' || !/^\d+(?:\.\d+)?$/.test(totalValueUsd)
    || (totalValueEth !== null && (typeof totalValueEth !== 'string' || !/^\d+(?:\.\d+)?$/.test(totalValueEth)))) {
    throw new Error('Invalid stored portfolio history row');
  }
  const timestamp = recordedAt instanceof Date ? recordedAt
    : typeof recordedAt === 'string' ? new Date(recordedAt) : null;
  if (timestamp === null || !Number.isFinite(timestamp.getTime())) {
    throw new Error('Invalid stored portfolio history timestamp');
  }
  return { id, portfolioId, totalValueUsd, totalValueEth, recordedAt: timestamp };
}

export abstract class AnalyticsRepository {
  abstract ownedState(userId: string, portfolioId: string): Promise<PortfolioState | null>;
  abstract activeState(portfolioId: string): Promise<PortfolioState | null>;
  abstract activePortfolioIds(): Promise<string[]>;
  abstract ownedHistory(userId: string, portfolioId: string, from: Date, to: Date, limit: number): Promise<AnalyticsSnapshot[]>;
  abstract ownedHistoricalBaseline(userId: string, portfolioId: string, from: Date, to: Date): Promise<AnalyticsSnapshot | null>;
  abstract insertSnapshotIfAbsent(input: SnapshotInsert): Promise<boolean>;
}

@Injectable()
export class DrizzleAnalyticsRepository extends AnalyticsRepository {
  constructor(@Inject(DatabaseService) private readonly database: Pick<DatabaseService, 'db'>) { super(); }

  ownedState(userId: string, portfolioId: string): Promise<PortfolioState | null> {
    return this.database.db.transaction(async (transaction) => {
      const [portfolio] = await transaction.select().from(portfolios)
        .where(activeOwnedPortfolio(userId, portfolioId)).limit(1);
      if (!portfolio) return null;
      const rows = await transaction.select({ holding: holdings }).from(holdings)
        .innerJoin(portfolios, eq(holdings.portfolioId, portfolios.id))
        .where(activeOwnedPortfolio(userId, portfolioId)).orderBy(asc(holdings.assetKey));
      return { portfolio, holdings: rows.map((row) => row.holding) };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  activeState(portfolioId: string): Promise<PortfolioState | null> {
    return this.database.db.transaction(async (transaction) => {
      const [portfolio] = await transaction.select().from(portfolios)
        .where(and(eq(portfolios.id, portfolioId), isNull(portfolios.archivedAt))).limit(1);
      if (!portfolio) return null;
      const rows = await transaction.select().from(holdings).where(eq(holdings.portfolioId, portfolioId))
        .orderBy(asc(holdings.assetKey));
      return { portfolio, holdings: rows };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async activePortfolioIds(): Promise<string[]> {
    const rows = await this.database.db.select({ id: portfolios.id }).from(portfolios)
      .where(isNull(portfolios.archivedAt)).orderBy(asc(portfolios.id));
    return rows.map((row) => row.id);
  }

  async ownedHistory(userId: string, portfolioId: string, from: Date, to: Date, limit: number): Promise<AnalyticsSnapshot[]> {
    // Rank the complete range in PostgreSQL, then choose the first point in each
    // equally spaced rank bucket. Both endpoints survive and the response is bounded.
    const result = await this.database.db.execute<Record<string, unknown>>(sql`
      WITH ranked AS (
        SELECT ${portfolioSnapshots.id} AS id, ${portfolioSnapshots.portfolioId} AS "portfolioId",
          ${portfolioSnapshots.totalValueUsd} AS "totalValueUsd", ${portfolioSnapshots.totalValueEth} AS "totalValueEth",
          ${portfolioSnapshots.recordedAt} AS "recordedAt",
          row_number() OVER (ORDER BY ${portfolioSnapshots.recordedAt}, ${portfolioSnapshots.id}) AS position,
          count(*) OVER () AS size
        FROM ${portfolioSnapshots}
        INNER JOIN ${portfolios} ON ${portfolioSnapshots.portfolioId} = ${portfolios.id}
        WHERE ${activeOwnedPortfolio(userId, portfolioId)}
          AND ${portfolioSnapshots.recordedAt} >= ${from} AND ${portfolioSnapshots.recordedAt} <= ${to}
      ), bucketed AS (
        SELECT *, (position - 1) * (${limit}::bigint - 1) / greatest(size - 1, 1) AS bucket FROM ranked
      )
      SELECT DISTINCT ON (bucket) id, "portfolioId", "totalValueUsd", "totalValueEth", "recordedAt"
      FROM bucketed ORDER BY bucket, "recordedAt", id
    `);
    return result.rows.map(decodeHistorySnapshotRow);
  }

  async ownedHistoricalBaseline(userId: string, portfolioId: string, from: Date, to: Date): Promise<AnalyticsSnapshot | null> {
    const [row] = await this.database.db.select({ snapshot: portfolioSnapshots }).from(portfolioSnapshots)
      .innerJoin(portfolios, eq(portfolioSnapshots.portfolioId, portfolios.id))
      .where(and(activeOwnedPortfolio(userId, portfolioId), gte(portfolioSnapshots.recordedAt, from), lte(portfolioSnapshots.recordedAt, to)))
      .orderBy(desc(portfolioSnapshots.recordedAt), desc(portfolioSnapshots.id)).limit(1);
    return row?.snapshot ?? null;
  }

  insertSnapshotIfAbsent(input: SnapshotInsert): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      // The index is deliberately reused: no new uniqueness migration is needed.
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`snapshot:${input.portfolioId}`}, 0))`);
      const [portfolio] = await transaction.select({ id: portfolios.id }).from(portfolios)
        .where(and(eq(portfolios.id, input.portfolioId), isNull(portfolios.archivedAt))).for('share').limit(1);
      if (!portfolio) return false;
      const [existing] = await transaction.select({ id: portfolioSnapshots.id }).from(portfolioSnapshots)
        .where(and(eq(portfolioSnapshots.portfolioId, input.portfolioId),
          gte(portfolioSnapshots.recordedAt, input.bucketStart), lt(portfolioSnapshots.recordedAt, input.bucketEnd))).limit(1);
      if (existing) return false;
      await transaction.insert(portfolioSnapshots).values({
        portfolioId: input.portfolioId, totalValueUsd: input.totalValueUsd,
        totalValueEth: input.totalValueEth, recordedAt: input.recordedAt,
      });
      return true;
    });
  }
}
