import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { WatchlistItemCreateInput } from '@blockchain-explorer/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { watchlistItems, watchlists } from '../../database/schema/index.js';

export type WatchlistRecord = typeof watchlists.$inferSelect;
export type WatchlistItemRecord = typeof watchlistItems.$inferSelect;

export function ownedWatchlist(userId: string, id?: string) {
  return and(eq(watchlists.userId, userId), id === undefined ? undefined : eq(watchlists.id, id));
}

@Injectable()
export class WatchlistsRepository {
  constructor(@Inject(DatabaseService) private readonly database: Pick<DatabaseService, 'db'>) {}

  async create(userId: string, name: string): Promise<WatchlistRecord> {
    const [row] = await this.database.db.insert(watchlists).values({ userId, name }).returning();
    if (!row) throw new Error('Watchlist insert returned no row');
    return row;
  }

  list(userId: string, page: number, limit: number): Promise<{ items: WatchlistRecord[]; total: number }> {
    return this.database.db.transaction(async (transaction) => {
      const [result] = await transaction.select({ total: count() }).from(watchlists).where(ownedWatchlist(userId));
      const items = await transaction.select().from(watchlists).where(ownedWatchlist(userId))
        .orderBy(desc(watchlists.createdAt), asc(watchlists.id)).limit(limit).offset((page - 1) * limit);
      return { items, total: result?.total ?? 0 };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async findOwned(userId: string, id: string): Promise<WatchlistRecord | null> {
    const [row] = await this.database.db.select().from(watchlists).where(ownedWatchlist(userId, id)).limit(1);
    return row ?? null;
  }

  async itemsOwned(userId: string, id: string): Promise<WatchlistItemRecord[]> {
    const rows = await this.database.db.select({ item: watchlistItems }).from(watchlistItems)
      .innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
      .where(ownedWatchlist(userId, id)).orderBy(asc(watchlistItems.createdAt), asc(watchlistItems.id));
    return rows.map((row) => row.item);
  }

  async renameOwned(userId: string, id: string, name: string): Promise<WatchlistRecord | null> {
    const [row] = await this.database.db.update(watchlists).set({ name }).where(ownedWatchlist(userId, id)).returning();
    return row ?? null;
  }

  async deleteOwned(userId: string, id: string): Promise<boolean> {
    const rows = await this.database.db.delete(watchlists).where(ownedWatchlist(userId, id)).returning({ id: watchlists.id });
    return rows.length > 0;
  }

  addItemOwned(userId: string, id: string, input: WatchlistItemCreateInput): Promise<WatchlistItemRecord> {
    return this.database.db.transaction(async (transaction) => {
      const [owner] = await transaction.select({ id: watchlists.id }).from(watchlists)
        .where(ownedWatchlist(userId, id)).for('update').limit(1);
      if (!owner) throw new NotFoundException('Watchlist not found');
      // The parent row lock serializes inserts and also covers historical mixed-case addresses.
      const [duplicate] = await transaction.select({ id: watchlistItems.id }).from(watchlistItems)
        .where(and(eq(watchlistItems.watchlistId, id), eq(watchlistItems.itemType, input.itemType),
          sql`lower(${watchlistItems.address}) = ${input.address}`)).limit(1);
      if (duplicate) throw new ConflictException('Watchlist item already exists');
      const [row] = await transaction.insert(watchlistItems).values({
        watchlistId: id, itemType: input.itemType, address: input.address, label: input.label ?? null,
      }).onConflictDoNothing({ target: [watchlistItems.watchlistId, watchlistItems.itemType, watchlistItems.address] }).returning();
      if (!row) throw new ConflictException('Watchlist item already exists');
      return row;
    });
  }

  removeItemOwned(userId: string, id: string, itemId: string): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      const [owner] = await transaction.select({ id: watchlists.id }).from(watchlists)
        .where(ownedWatchlist(userId, id)).for('update').limit(1);
      if (!owner) throw new NotFoundException('Watchlist not found');
      const rows = await transaction.delete(watchlistItems)
        .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.watchlistId, id)))
        .returning({ id: watchlistItems.id });
      return rows.length > 0;
    });
  }
}
