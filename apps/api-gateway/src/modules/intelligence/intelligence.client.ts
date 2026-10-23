import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { decodePortfolioPnl, decodePortfolioTrade, decodePortfolioTrades, type PortfolioPnlResponse, type PortfolioTradeInput, type PortfolioTradeListResponse, type PortfolioTradeResponse } from '@blockchain-explorer/contracts';
import { ConfigService } from '@nestjs/config';
import type {
  AlertCreateInput, AlertEventListResponse, AlertEventResponse, AlertListResponse, AlertResponse, AlertUpdateInput,
  AssetPriceResponse, PortfolioAnalyticsResponse, PortfolioHistoryRange, PortfolioHistoryResponse, PortfolioValuationResponse,
  WatchlistCreateInput, WatchlistDetailResponse, WatchlistItemCreateInput, WatchlistItemResponse,
  WatchlistListResponse, WatchlistResponse, WatchlistUpdateInput,
} from '@blockchain-explorer/contracts';
import { PortfolioHttpClient } from '../../common/http/portfolio-http.client.js';
import {
  decodeAlert, decodeAlertEvent, decodeAnalytics, decodeHistory, decodePaginated, decodePrice,
  decodeValuation, decodeWatchlist, decodeWatchlistDetail, decodeWatchlistItem,
} from '../../common/http/intelligence-response.decoder.js';

@Injectable()
export class IntelligenceClient extends PortfolioHttpClient {
  constructor(config: ConfigService) { super(config); }

  async ethereumPrice(): Promise<AssetPriceResponse> {
    return decodePrice(await this.request('GET', '/internal/prices/eth'));
  }
  async tokenPrice(address: string): Promise<AssetPriceResponse> {
    return decodePrice(await this.request('GET', `/internal/prices/token/${encodeURIComponent(address)}`));
  }
  async valuation(userId: string, id: string): Promise<PortfolioValuationResponse> {
    return decodeValuation(await this.request('GET', `/internal/portfolios/${encodeURIComponent(id)}/valuation`, { userId }));
  }
  async history(userId: string, id: string, range: PortfolioHistoryRange, limit: number): Promise<PortfolioHistoryResponse> {
    return decodeHistory(await this.request('GET', `/internal/portfolios/${encodeURIComponent(id)}/history`, { userId, range, limit }));
  }
  async analytics(userId: string, id: string): Promise<PortfolioAnalyticsResponse> {
    return decodeAnalytics(await this.request('GET', `/internal/portfolios/${encodeURIComponent(id)}/analytics`, { userId }));
  }
  async pnl(userId: string, id: string): Promise<PortfolioPnlResponse> {
    return this.decodePnl(decodePortfolioPnl, await this.request('GET', `/internal/portfolios/${encodeURIComponent(id)}/pnl`, { userId }));
  }
  async trades(userId: string, id: string, page: number, limit: number): Promise<PortfolioTradeListResponse> {
    return this.decodePnl(decodePortfolioTrades, await this.request('GET', `/internal/portfolios/${encodeURIComponent(id)}/trades`, { userId, page, limit }));
  }
  async saveTrade(userId: string, id: string, input: PortfolioTradeInput, tradeId?: string): Promise<PortfolioTradeResponse> {
    // Explicit projection prevents caller properties from overriding authenticated identity.
    const body: PortfolioTradeInput = { clientId: input.clientId, assetKey: input.assetKey, symbol: input.symbol, decimals: input.decimals,
      side: input.side, quantityRaw: input.quantityRaw, unitPriceUsd: input.unitPriceUsd, feeUsd: input.feeUsd,
      occurredAt: input.occurredAt, transactionHash: input.transactionHash, activityId: input.activityId };
    const path = `/internal/portfolios/${encodeURIComponent(id)}/trades${tradeId ? `/${encodeURIComponent(tradeId)}` : ''}`;
    return this.decodePnl(decodePortfolioTrade, await this.request(tradeId ? 'PATCH' : 'POST', path, { userId }, body));
  }
  async deleteTrade(userId: string, id: string, tradeId: string): Promise<void> {
    await this.request('DELETE', `/internal/portfolios/${encodeURIComponent(id)}/trades/${encodeURIComponent(tradeId)}`, { userId });
  }
  private decodePnl<T>(decode: (value: unknown) => T, value: unknown): T {
    try { return decode(value); } catch { throw new BadGatewayException('Portfolio service returned an invalid P&L response'); }
  }
  async createWatchlist(userId: string, input: WatchlistCreateInput): Promise<WatchlistResponse> {
    return decodeWatchlist(await this.request('POST', '/internal/watchlists', undefined, { userId, name: input.name }));
  }
  async watchlists(userId: string, page: number, limit: number): Promise<WatchlistListResponse> {
    return decodePaginated(await this.request('GET', '/internal/watchlists', { userId, page, limit }), decodeWatchlist);
  }
  async watchlist(userId: string, id: string): Promise<WatchlistDetailResponse> {
    return decodeWatchlistDetail(await this.request('GET', this.watchlistPath(id), { userId }));
  }
  async updateWatchlist(userId: string, id: string, input: WatchlistUpdateInput): Promise<WatchlistResponse> {
    return decodeWatchlist(await this.request('PATCH', this.watchlistPath(id), { userId }, { name: input.name }));
  }
  async deleteWatchlist(userId: string, id: string): Promise<void> {
    await this.request('DELETE', this.watchlistPath(id), { userId });
  }
  async addWatchlistItem(userId: string, id: string, input: WatchlistItemCreateInput): Promise<WatchlistItemResponse> {
    return decodeWatchlistItem(await this.request('POST', `${this.watchlistPath(id)}/items`, { userId }, {
      itemType: input.itemType, address: input.address, ...(input.label === undefined ? {} : { label: input.label }),
    }));
  }
  async deleteWatchlistItem(userId: string, id: string, itemId: string): Promise<void> {
    await this.request('DELETE', `${this.watchlistPath(id)}/items/${encodeURIComponent(itemId)}`, { userId });
  }
  async createAlert(userId: string, input: AlertCreateInput): Promise<AlertResponse> {
    return decodeAlert(await this.request('POST', '/internal/alerts', undefined, { userId, ...this.alertFields(input) }));
  }
  async alerts(userId: string, page: number, limit: number): Promise<AlertListResponse> {
    return decodePaginated(await this.request('GET', '/internal/alerts', { userId, page, limit }), decodeAlert);
  }
  async alert(userId: string, id: string): Promise<AlertResponse> {
    return decodeAlert(await this.request('GET', this.alertPath(id), { userId }));
  }
  async updateAlert(userId: string, id: string, input: AlertUpdateInput): Promise<AlertResponse> {
    const fields = this.alertFields(input);
    if (Object.keys(fields).length === 0) throw new BadRequestException('At least one alert field is required');
    return decodeAlert(await this.request('PATCH', this.alertPath(id), { userId }, fields));
  }
  async deleteAlert(userId: string, id: string): Promise<void> {
    await this.request('DELETE', this.alertPath(id), { userId });
  }
  async alertEvents(userId: string, page: number, limit: number): Promise<AlertEventListResponse> {
    return decodePaginated(await this.request('GET', '/internal/alerts/events', { userId, page, limit }), decodeAlertEvent);
  }
  async markAlertRead(userId: string, id: string): Promise<AlertEventResponse> {
    return decodeAlertEvent(await this.request('PATCH', `/internal/alerts/events/${encodeURIComponent(id)}/read`, { userId }));
  }

  private watchlistPath(id: string): string { return `/internal/watchlists/${encodeURIComponent(id)}`; }
  private alertPath(id: string): string { return `/internal/alerts/${encodeURIComponent(id)}`; }
  private alertFields(input: AlertCreateInput | AlertUpdateInput): object {
    return {
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.walletAddress === undefined ? {} : { walletAddress: input.walletAddress }),
      ...(input.tokenAddress === undefined ? {} : { tokenAddress: input.tokenAddress }),
      ...(input.thresholdUsd === undefined ? {} : { thresholdUsd: input.thresholdUsd }),
    };
  }
}
