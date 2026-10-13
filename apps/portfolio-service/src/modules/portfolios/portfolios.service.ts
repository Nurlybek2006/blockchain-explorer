import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isEthereumAddress,
  normalizeEthereumAddress,
  type PortfolioCreateInput,
  type PortfolioDetailResponse,
  type PortfolioHoldingResponse,
  type PortfolioListResponse,
  type PortfolioResponse,
  type PortfolioUpdateInput,
} from '@blockchain-explorer/contracts';
import { formatTokenBalance } from '../../common/utils/format-token-balance.js';
import {
  PortfoliosRepository,
  type HoldingRecord,
  type PortfolioRecord,
} from './portfolios.repository.js';
import { PortfolioInitialSyncDispatcher } from './portfolio-initial-sync.dispatcher.js';

type PortfolioStore = Pick<PortfoliosRepository,
  'create' | 'listOwned' | 'findOwned' | 'listOwnedHoldings' | 'renameOwned' | 'archiveOwned'>;

@Injectable()
export class PortfoliosService {
  private readonly chainId: number;

  constructor(
    @Inject(PortfoliosRepository)
    private readonly repository: PortfolioStore,
    config: ConfigService,
    @Inject(PortfolioInitialSyncDispatcher)
    private readonly initialSync: Pick<PortfolioInitialSyncDispatcher, 'flush'>,
  ) {
    this.chainId = Number(config.get<string>('ETHEREUM_CHAIN_ID') ?? 11_155_111);
    if (!Number.isSafeInteger(this.chainId) || this.chainId < 1 || this.chainId > 2_147_483_647) {
      throw new Error('ETHEREUM_CHAIN_ID must be a positive PostgreSQL integer');
    }
  }

  async create(userId: string, input: PortfolioCreateInput): Promise<PortfolioResponse> {
    if (!isEthereumAddress(input.walletAddress)) {
      throw new BadRequestException('Invalid Ethereum address');
    }
    const chainId = input.chainId ?? this.chainId;
    if (chainId !== this.chainId) {
      throw new BadRequestException('The requested chain is not supported by this service');
    }
    const portfolio = await this.repository.create({
      userId,
      name: input.name.trim(),
      walletAddress: normalizeEthereumAddress(input.walletAddress),
      chainId,
    });
    // Redis availability must not turn a committed create into a failed HTTP
    // response; the transactional intent remains available to the dispatcher.
    void this.initialSync.flush();
    return serializePortfolio(portfolio);
  }

  async list(userId: string, page: number, limit: number): Promise<PortfolioListResponse> {
    const { items, total } = await this.repository.listOwned(userId, page, limit);
    return { items: items.map(serializePortfolio), page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async detail(userId: string, id: string): Promise<PortfolioDetailResponse> {
    const portfolio = await this.getOwned(userId, id);
    const holdings = await this.repository.listOwnedHoldings(userId, id);
    return { ...serializePortfolio(portfolio), holdings: holdings.map(serializeHolding) };
  }

  async holdings(userId: string, id: string): Promise<PortfolioHoldingResponse[]> {
    await this.getOwned(userId, id);
    return (await this.repository.listOwnedHoldings(userId, id)).map(serializeHolding);
  }

  async rename(userId: string, id: string, input: PortfolioUpdateInput): Promise<PortfolioResponse> {
    const portfolio = await this.repository.renameOwned(userId, id, input.name.trim());
    if (!portfolio) {
      throw new NotFoundException('Portfolio not found');
    }
    return serializePortfolio(portfolio);
  }

  async archive(userId: string, id: string): Promise<void> {
    if (!await this.repository.archiveOwned(userId, id)) {
      throw new NotFoundException('Portfolio not found');
    }
  }

  private async getOwned(userId: string, id: string): Promise<PortfolioRecord> {
    const portfolio = await this.repository.findOwned(userId, id);
    if (!portfolio) {
      throw new NotFoundException('Portfolio not found');
    }
    return portfolio;
  }
}

export function serializePortfolio(portfolio: PortfolioRecord): PortfolioResponse {
  return {
    id: portfolio.id,
    name: portfolio.name,
    walletAddress: portfolio.walletAddress,
    chainId: portfolio.chainId,
    isPrimary: portfolio.isPrimary,
    createdAt: portfolio.createdAt.toISOString(),
    updatedAt: portfolio.updatedAt.toISOString(),
  };
}

export function serializeHolding(holding: HoldingRecord): PortfolioHoldingResponse {
  return {
    assetKey: holding.assetKey,
    assetType: holding.assetType,
    tokenAddress: holding.tokenAddress,
    symbol: holding.symbol,
    name: holding.name,
    decimals: holding.decimals,
    balanceRaw: holding.balanceRaw,
    balanceFormatted: formatTokenBalance(holding.balanceRaw, holding.decimals),
    lastUpdatedBlock: holding.lastUpdatedBlock?.toString() ?? null,
    updatedAt: holding.updatedAt.toISOString(),
  };
}
