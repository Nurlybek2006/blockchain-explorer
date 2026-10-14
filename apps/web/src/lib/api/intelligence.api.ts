import type { AlertCreateInput, AlertUpdateInput, WatchlistCreateInput, WatchlistItemCreateInput, WatchlistUpdateInput } from '@blockchain-explorer/contracts';
import { apiRequest } from './client';
import { decodeAlert, decodeAlertEvent, decodeAlertEventList, decodeAlertList, decodePrice, decodeVoid, decodeWatchlist, decodeWatchlistDetail, decodeWatchlistItem, decodeWatchlistList } from './intelligence.decoder';

export const intelligenceApi = {
  ethPrice: (signal?: AbortSignal) => apiRequest('/prices/eth', { signal, decode: decodePrice }),
  tokenPrice: (address: string, signal?: AbortSignal) => apiRequest(`/prices/token/${encodeURIComponent(address)}`, { signal, decode: decodePrice }),
  watchlists: (page = 1, signal?: AbortSignal) => apiRequest('/watchlists', { authenticated: true, query: { page, limit: 12 }, signal, decode: decodeWatchlistList }),
  watchlist: (id: string, signal?: AbortSignal) => apiRequest(`/watchlists/${encodeURIComponent(id)}`, { authenticated: true, signal, decode: decodeWatchlistDetail }),
  createWatchlist: (input: WatchlistCreateInput) => apiRequest('/watchlists', { method: 'POST', authenticated: true, body: input, decode: decodeWatchlist }),
  renameWatchlist: (id: string, input: WatchlistUpdateInput) => apiRequest(`/watchlists/${encodeURIComponent(id)}`, { method: 'PATCH', authenticated: true, body: input, decode: decodeWatchlist }),
  deleteWatchlist: (id: string) => apiRequest(`/watchlists/${encodeURIComponent(id)}`, { method: 'DELETE', authenticated: true, decode: decodeVoid }),
  addItem: (id: string, input: WatchlistItemCreateInput) => apiRequest(`/watchlists/${encodeURIComponent(id)}/items`, { method: 'POST', authenticated: true, body: input, decode: decodeWatchlistItem }),
  removeItem: (id: string, itemId: string) => apiRequest(`/watchlists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE', authenticated: true, decode: decodeVoid }),
  alerts: (page = 1, signal?: AbortSignal) => apiRequest('/alerts', { authenticated: true, query: { page, limit: 12 }, signal, decode: decodeAlertList }),
  createAlert: (input: AlertCreateInput) => apiRequest('/alerts', { method: 'POST', authenticated: true, body: input, decode: decodeAlert }),
  updateAlert: (id: string, input: AlertUpdateInput) => apiRequest(`/alerts/${encodeURIComponent(id)}`, { method: 'PATCH', authenticated: true, body: input, decode: decodeAlert }),
  deleteAlert: (id: string) => apiRequest(`/alerts/${encodeURIComponent(id)}`, { method: 'DELETE', authenticated: true, decode: decodeVoid }),
  alertEvents: (page = 1, signal?: AbortSignal) => apiRequest('/alerts/events', { authenticated: true, query: { page, limit: 12 }, signal, decode: decodeAlertEventList }),
  markRead: (id: string) => apiRequest(`/alerts/events/${encodeURIComponent(id)}/read`, { method: 'PATCH', authenticated: true, decode: decodeAlertEvent }),
};
