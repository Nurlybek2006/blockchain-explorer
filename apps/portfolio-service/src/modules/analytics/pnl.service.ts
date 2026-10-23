import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isPortfolioTradeInput, type PortfolioPnlResponse, type PortfolioTradeInput, type PortfolioTradeListResponse, type PortfolioTradeResponse } from '@blockchain-explorer/contracts';
import { toMoney } from '../../common/utils/decimal-math.js';
import { PricesService } from '../prices/prices.service.js';
import { TradesRepository, orderedTrade, type TradeRecord } from './trades.repository.js';
import { buildPnl } from './pnl.math.js';
import { buildValuation } from './valuation.math.js';

export function tradeResponse(row: TradeRecord): PortfolioTradeResponse {
  return { id: row.id, clientId: row.clientId, sequence: row.sequence.toString(), assetKey: row.assetKey, symbol: row.symbol,
    decimals: row.decimals, side: row.side, quantityRaw: row.quantityRaw, unitPriceUsd: row.unitPriceUsd === null ? null : toMoney(row.unitPriceUsd),
    feeUsd: toMoney(row.feeUsd), occurredAt: row.occurredAt.toISOString(), transactionHash: row.transactionHash, activityId: row.activityId };
}

@Injectable()
export class PnlService {
  constructor(@Inject(TradesRepository) private readonly repository: Pick<TradesRepository, 'snapshotOwned' | 'writeOwned'>,
    @Inject(PricesService) private readonly prices: Pick<PricesService, 'getPrices'>) {}

  async summary(userId: string, id: string): Promise<PortfolioPnlResponse> {
    const snapshot = await this.repository.snapshotOwned(userId, id);
    if (!snapshot) throw new NotFoundException('Portfolio not found');
    const quotes = await this.prices.getPrices([...new Set(snapshot.state.holdings.map(h => h.assetKey))]);
    return buildPnl(buildValuation(snapshot.state, new Map(quotes.map(p => [p.assetKey, p]))), snapshot.entries.map(orderedTrade));
  }

  async list(userId: string, id: string, page = 1, limit = 20): Promise<PortfolioTradeListResponse> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Invalid trade pagination');
    const snapshot = await this.repository.snapshotOwned(userId, id);
    if (!snapshot) throw new NotFoundException('Portfolio not found');
    const entries = [...snapshot.entries].reverse();
    return { items: entries.slice((page - 1) * limit, page * limit).map(tradeResponse), total: entries.length, page, limit, totalPages: Math.ceil(entries.length / limit) };
  }

  async save(userId: string, id: string, input: PortfolioTradeInput, entryId?: string): Promise<PortfolioTradeResponse> {
    if (!isPortfolioTradeInput(input) || Date.parse(input.occurredAt) > Date.now() + 300_000) throw new BadRequestException('Invalid trade');
    const row = await this.repository.writeOwned(userId, id, { ...input, clientId: input.clientId.toLowerCase() }, entryId);
    if (!row) throw new Error('Trade write returned no row');
    return tradeResponse(row);
  }
  async remove(userId: string, id: string, entryId: string): Promise<void> { await this.repository.writeOwned(userId, id, null, entryId); }
}
