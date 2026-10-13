import 'reflect-metadata';
import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema/index.js';
import { CreateWatchlistDto, CreateWatchlistItemDto } from './dto/watchlist.dto.js';
import { ownedWatchlist, type WatchlistItemRecord, type WatchlistRecord, type WatchlistsRepository } from './watchlists.repository.js';
import { WatchlistsService } from './watchlists.service.js';

const owner = 'f7d40b53-53b2-449b-b16a-673c93dc7d2c';
const foreign = 'f7d40b53-53b2-449b-b16a-673c93dc7d2d';
const id = '02d10b90-e68c-4604-b9af-a85c32830679';
const date = new Date('2026-10-14T00:00:00.000Z');
const watchlist: WatchlistRecord = { id, userId: owner, name: 'Tokens', createdAt: date };
const item: WatchlistItemRecord = { id: foreign, watchlistId: id, itemType: 'token', address: `0x${'a'.repeat(40)}`, label: 'Token', createdAt: date };
type Store = Pick<WatchlistsRepository,
  'create' | 'list' | 'findOwned' | 'itemsOwned' | 'renameOwned' | 'deleteOwned' | 'addItemOwned' | 'removeItemOwned'>;

describe('WatchlistsService ownership and normalization', () => {
  let store: Store;
  let service: WatchlistsService;
  beforeEach(() => {
    store = {
      create: vi.fn<Store['create']>().mockResolvedValue(watchlist),
      list: vi.fn<Store['list']>().mockResolvedValue({ items: [watchlist], total: 1 }),
      findOwned: vi.fn<Store['findOwned']>().mockImplementation(async (userId) => userId === owner ? watchlist : null),
      itemsOwned: vi.fn<Store['itemsOwned']>().mockResolvedValue([item]),
      renameOwned: vi.fn<Store['renameOwned']>().mockResolvedValue(null),
      deleteOwned: vi.fn<Store['deleteOwned']>().mockResolvedValue(false),
      addItemOwned: vi.fn<Store['addItemOwned']>().mockResolvedValue(item),
      removeItemOwned: vi.fn<Store['removeItemOwned']>().mockResolvedValue(false),
    };
    service = new WatchlistsService(store);
  });

  it('does not fetch items for foreign watchlist IDs', async () => {
    await expect(service.detail(foreign, id)).rejects.toBeInstanceOf(NotFoundException);
    expect(store.itemsOwned).not.toHaveBeenCalled();
    expect(await service.detail(owner, id)).toMatchObject({ id, items: [{ address: item.address }] });
    expect(store.itemsOwned).toHaveBeenCalledWith(owner, id);
  });

  it('passes ownership to every mutation and hides missing/foreign IDs', async () => {
    await expect(service.rename(foreign, id, { name: 'Renamed' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(foreign, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeItem(foreign, id, item.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(store.renameOwned).toHaveBeenCalledWith(foreign, id, 'Renamed');
    expect(store.deleteOwned).toHaveBeenCalledWith(foreign, id);
    expect(store.removeItemOwned).toHaveBeenCalledWith(foreign, id, item.id);
  });

  it('normalizes item addresses and exposes only public watchlist fields', async () => {
    expect(await service.create(owner, { name: ' Tokens ' })).not.toHaveProperty('userId');
    expect(store.create).toHaveBeenCalledWith(owner, 'Tokens');
    await service.addItem(owner, id, { itemType: 'token', address: `0x${'A'.repeat(40)}`, label: ' Token ' });
    expect(store.addItemOwned).toHaveBeenCalledWith(owner, id, { itemType: 'token', address: item.address, label: 'Token' });
    expect(await service.list(owner, 1, 20)).toMatchObject({ total: 1, totalPages: 1 });
  });
});

describe('Watchlist SQL and input contracts', () => {
  const database = drizzle.mock({ schema });
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

  it('requires both owner and ID for parent mutations and item reads', () => {
    const mutation = database.delete(schema.watchlists).where(ownedWatchlist(owner, id)).toSQL();
    expect(mutation.params).toEqual([owner, id]);
    expect(mutation.sql).toContain('"watchlists"."user_id"');
    const items = database.select().from(schema.watchlistItems)
      .innerJoin(schema.watchlists, eq(schema.watchlists.id, schema.watchlistItems.watchlistId))
      .where(ownedWatchlist(owner, id)).toSQL();
    expect(items.params).toEqual([owner, id]);
    expect(items.sql).toContain('inner join "watchlists"');
  });

  it('keeps the database uniqueness guard for concurrent item insertion', () => {
    const index = getTableConfig(schema.watchlistItems).indexes.find((entry) => entry.config.name === 'watchlist_items_unique_idx');
    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns).toHaveLength(3);
  });

  it.each([
    { itemType: 'token', address: '0x1234' },
    { itemType: 'unknown', address: item.address },
    { itemType: 'address', address: item.address, userId: foreign },
    { itemType: 'address', address: item.address, label: null },
  ])('rejects invalid item contracts and spoofed ownership', async (body) => {
    await expect(pipe.transform(body, { type: 'body', metatype: CreateWatchlistItemDto })).rejects.toMatchObject({ status: 400 });
  });

  it('validates owner UUID and trimmed names for creation', async () => {
    await expect(pipe.transform({ userId: 'bad-id', name: 'Tokens' }, { type: 'body', metatype: CreateWatchlistDto }))
      .rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ userId: owner, name: ' ' }, { type: 'body', metatype: CreateWatchlistDto }))
      .rejects.toMatchObject({ status: 400 });
  });
});
