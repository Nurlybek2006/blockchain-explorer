import type { PortfolioCreateInput, PortfolioHistoryRange, PortfolioUpdateInput } from '@blockchain-explorer/contracts';
import { apiRequest } from './client';
import { decodeAnalytics, decodeHistory, decodePortfolio, decodePortfolioDetail, decodePortfolioList, decodeValuation, decodeVoid } from './intelligence.decoder';
import { decodePortfolioPnl, decodePortfolioTrade, decodePortfolioTrades, type PortfolioTradeInput } from '@blockchain-explorer/contracts/browser';

export const portfolioApi = {
  pnl: (id: string, signal?: AbortSignal) => apiRequest(`/portfolio/${encodeURIComponent(id)}/pnl`, { authenticated: true, signal, decode: decodePortfolioPnl }),
  trades: (id: string, page = 1, signal?: AbortSignal) => apiRequest(`/portfolio/${encodeURIComponent(id)}/trades`, { authenticated: true, query: { page, limit: 20 }, signal, decode: decodePortfolioTrades }),
  saveTrade: (id: string, input: PortfolioTradeInput, tradeId?: string) => apiRequest(`/portfolio/${encodeURIComponent(id)}/trades${tradeId ? `/${encodeURIComponent(tradeId)}` : ''}`, { method: tradeId ? 'PATCH' : 'POST', body: input, authenticated: true, decode: decodePortfolioTrade }),
  deleteTrade: (id: string, tradeId: string) => apiRequest(`/portfolio/${encodeURIComponent(id)}/trades/${encodeURIComponent(tradeId)}`, { method: 'DELETE', authenticated: true, decode: decodeVoid }),
  list: (page = 1, signal?: AbortSignal) => apiRequest('/portfolio', { authenticated: true, query: { page, limit: 6 }, signal, decode: decodePortfolioList }),
  detail: (id: string, signal?: AbortSignal) => apiRequest(`/portfolio/${encodeURIComponent(id)}`, { authenticated: true, signal, decode: decodePortfolioDetail }),
  valuation: (id: string, signal?: AbortSignal) => apiRequest(`/portfolio/${encodeURIComponent(id)}/valuation`, { authenticated: true, signal, decode: decodeValuation }),
  analytics: (id: string, signal?: AbortSignal) => apiRequest(`/portfolio/${encodeURIComponent(id)}/analytics`, { authenticated: true, signal, decode: decodeAnalytics }),
  history: (id: string, range: PortfolioHistoryRange, signal?: AbortSignal) => apiRequest(`/portfolio/${encodeURIComponent(id)}/history`, { authenticated: true, query: { range, limit: 100 }, signal, decode: decodeHistory }),
  create: (input: PortfolioCreateInput) => apiRequest('/portfolio', { method: 'POST', body: input, authenticated: true, decode: decodePortfolio }),
  rename: (id: string, input: PortfolioUpdateInput) => apiRequest(`/portfolio/${encodeURIComponent(id)}`, { method: 'PATCH', body: input, authenticated: true, decode: decodePortfolio }),
  archive: (id: string) => apiRequest(`/portfolio/${encodeURIComponent(id)}`, { method: 'DELETE', authenticated: true, decode: decodeVoid }),
};
