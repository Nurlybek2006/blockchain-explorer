import { apiRequest } from './client';
import { decodeContract, decodeNetworkStatus, decodeSearch, decodeTraces } from './advanced-explorer.decoder';
export const advancedExplorerApi = {
  contract: (address: string, signal?: AbortSignal) => apiRequest(`/contract/${encodeURIComponent(address)}`, { decode: decodeContract, signal }),
  traces: (hash: string, signal?: AbortSignal) => apiRequest(`/tx/${encodeURIComponent(hash)}/traces`, { decode: decodeTraces, signal }),
  search: (q: string, signal?: AbortSignal) => apiRequest('/search', { decode: decodeSearch, query: { q }, signal }),
  networkStatus: (signal?: AbortSignal) => apiRequest('/network/status', { decode: decodeNetworkStatus, signal }),
};
