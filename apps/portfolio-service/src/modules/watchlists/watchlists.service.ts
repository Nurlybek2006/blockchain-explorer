import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  normalizeEthereumAddress,
  type WatchlistCreateInput,
  type WatchlistDetailResponse,
  type WatchlistItemCreateInput,
  type WatchlistItemResponse,
  type WatchlistListResponse,
  type WatchlistResponse,
  type WatchlistUpdateInput,
} from '@blockchain-explorer/contracts';
import { WatchlistsRepository, type WatchlistItemRecord, type WatchlistRecord } from './watchlists.repository.js';

type Store = Pick<WatchlistsRepository,
  'create' | 'list' | 'findOwned' | 'itemsOwned' | 'renameOwned' | 'deleteOwned' | 'addItemOwned' | 'removeItemOwned'>;

@Injectable()
export class WatchlistsService {
  constructor(@Inject(WatchlistsRepository) private readonly repository: Store) {}

  async create(userId: string, input: WatchlistCreateInput): Promise<WatchlistResponse> {
    return serializeWatchlist(await this.repository.create(userId, input.name.trim()));
  }

  async list(userId: string, page: number, limit: number): Promise<WatchlistListResponse> {
    const { items, total } = await this.repository.list(userId, page, limit);
    return { items: items.map(serializeWatchlist), page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async detail(userId: string, id: string): Promise<WatchlistDetailResponse> {
    const row = await this.repository.findOwned(userId, id);
    if (!row) throw new NotFoundException('Watchlist not found');
    return { ...serializeWatchlist(row), items: (await this.repository.itemsOwned(userId, id)).map(serializeWatchlistItem) };
  }

  async rename(userId: string, id: string, input: WatchlistUpdateInput): Promise<WatchlistResponse> {
    const row = await this.repository.renameOwned(userId, id, input.name.trim());
    if (!row) throw new NotFoundException('Watchlist not found');
    return serializeWatchlist(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!await this.repository.deleteOwned(userId, id)) throw new NotFoundException('Watchlist not found');
  }

  async addItem(userId: string, id: string, input: WatchlistItemCreateInput): Promise<WatchlistItemResponse> {
    return serializeWatchlistItem(await this.repository.addItemOwned(userId, id, {
      itemType: input.itemType,
      address: normalizeEthereumAddress(input.address),
      ...(input.label === undefined ? {} : { label: input.label.trim() }),
    }));
  }

  async removeItem(userId: string, id: string, itemId: string): Promise<void> {
    if (!await this.repository.removeItemOwned(userId, id, itemId)) throw new NotFoundException('Watchlist item not found');
  }
}

export function serializeWatchlist(row: WatchlistRecord): WatchlistResponse {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

export function serializeWatchlistItem(row: WatchlistItemRecord): WatchlistItemResponse {
  if (row.itemType !== 'address' && row.itemType !== 'token') throw new Error('Invalid stored watchlist item type');
  return {
    id: row.id, watchlistId: row.watchlistId, itemType: row.itemType,
    address: row.address, label: row.label, createdAt: row.createdAt.toISOString(),
  };
}
