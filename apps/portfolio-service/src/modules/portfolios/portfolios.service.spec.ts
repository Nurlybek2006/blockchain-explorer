import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortfolioInitialSyncDispatcher } from './portfolio-initial-sync.dispatcher.js';
import type { HoldingRecord, PortfolioRecord, PortfoliosRepository } from './portfolios.repository.js';
import { PortfoliosService, serializeHolding } from './portfolios.service.js';

const owner = 'f7d40b53-53b2-449b-b16a-673c93dc7d2c';
const otherUser = 'f7d40b53-53b2-449b-b16a-673c93dc7d2d';
const portfolioId = '02d10b90-e68c-4604-b9af-a85c32830679';
const date = new Date('2026-01-01T00:00:00.000Z');
const portfolio: PortfolioRecord = {
  id: portfolioId,
  userId: owner,
  name: 'Main',
  walletAddress: `0x${'a'.repeat(40)}`,
  chainId: 11_155_111,
  isPrimary: true,
  archivedAt: null,
  createdAt: date,
  updatedAt: date,
};

type Store = Pick<PortfoliosRepository,
  'create' | 'listOwned' | 'findOwned' | 'listOwnedHoldings' | 'renameOwned' | 'archiveOwned'>;

describe('PortfoliosService ownership', () => {
  let repository: Store;
  let sync: Pick<PortfolioInitialSyncDispatcher, 'flush'>;
  let service: PortfoliosService;

  beforeEach(() => {
    repository = {
      create: vi.fn<Store['create']>().mockResolvedValue(portfolio),
      listOwned: vi.fn<Store['listOwned']>().mockResolvedValue({ items: [portfolio], total: 1 }),
      findOwned: vi.fn<Store['findOwned']>().mockImplementation(async (userId) => userId === owner ? portfolio : null),
      listOwnedHoldings: vi.fn<Store['listOwnedHoldings']>().mockResolvedValue([]),
      renameOwned: vi.fn<Store['renameOwned']>().mockResolvedValue(null),
      archiveOwned: vi.fn<Store['archiveOwned']>().mockResolvedValue(false),
    };
    sync = { flush: vi.fn<PortfolioInitialSyncDispatcher['flush']>().mockResolvedValue() };
    service = new PortfoliosService(repository, new ConfigService(), sync);
  });

  it('does not fetch holdings for a foreign or missing portfolio', async () => {
    await expect(service.detail(otherUser, portfolioId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.holdings(otherUser, portfolioId)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findOwned).toHaveBeenCalledWith(otherUser, portfolioId);
    expect(repository.listOwnedHoldings).not.toHaveBeenCalled();
  });

  it('passes the owner to every mutation and rejects foreign IDs with 404', async () => {
    await expect(service.rename(otherUser, portfolioId, { name: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.archive(otherUser, portfolioId)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.renameOwned).toHaveBeenCalledWith(otherUser, portfolioId, 'New');
    expect(repository.archiveOwned).toHaveBeenCalledWith(otherUser, portfolioId);
  });

  it('normalizes wallet, uses configured chain and dispatches committed sync intent', async () => {
    const response = await service.create(owner, { name: ' Main ', walletAddress: `0x${'A'.repeat(40)}` });
    expect(repository.create).toHaveBeenCalledWith({
      userId: owner, name: 'Main', walletAddress: `0x${'a'.repeat(40)}`, chainId: 11_155_111,
    });
    expect(sync.flush).toHaveBeenCalledOnce();
    expect(response.createdAt).toBe(date.toISOString());
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('archivedAt');
  });

  it('rejects unsupported chain and invalid wallets before inserting', async () => {
    await expect(service.create(owner, { name: 'Main', walletAddress: portfolio.walletAddress, chainId: 1 }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(owner, { name: 'Main', walletAddress: '0x123' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
    expect(sync.flush).not.toHaveBeenCalled();
  });

  it('scopes list and holdings calls and preserves paginated response metadata', async () => {
    expect(await service.list(owner, 2, 20)).toMatchObject({ page: 2, limit: 20, total: 1, totalPages: 1 });
    expect(repository.listOwned).toHaveBeenCalledWith(owner, 2, 20);
    await service.holdings(owner, portfolioId);
    expect(repository.listOwnedHoldings).toHaveBeenCalledWith(owner, portfolioId);
  });
});

describe('holding serialization', () => {
  it('returns exact balance and block strings and serializable timestamps', () => {
    const holding: HoldingRecord = {
      id: portfolioId,
      portfolioId,
      assetKey: 'native:eth',
      assetType: 'native',
      tokenAddress: null,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      balanceRaw: '123456789012345678901234567890',
      lastUpdatedBlock: 9007199254740993n,
      updatedAt: date,
    };
    expect(serializeHolding(holding)).toMatchObject({
      balanceRaw: '123456789012345678901234567890',
      balanceFormatted: '123456789012.34567890123456789',
      lastUpdatedBlock: '9007199254740993',
      updatedAt: date.toISOString(),
    });
    expect(() => JSON.stringify(serializeHolding(holding))).not.toThrow();
  });
});
