import { apiRequest } from './client';
import { decodeExplorerAddressDetail, decodeExplorerBlockDetail, decodeExplorerBlocks, decodeExplorerStats, decodeExplorerTokenDetail, decodeExplorerTokens, decodeExplorerTransactionDetail } from './explorer.decoder';

export const explorerApi = {
  stats: (signal?: AbortSignal) => apiRequest('/stats', { decode: decodeExplorerStats, signal }),
  blocks: (page = 1, limit = 20, signal?: AbortSignal) => apiRequest('/blocks', { decode: decodeExplorerBlocks, query: { page, limit }, signal }),
  block: (number: string, signal?: AbortSignal) => apiRequest(`/blocks/${encodeURIComponent(number)}`, { decode: decodeExplorerBlockDetail, signal }),
  transaction: (hash: string, signal?: AbortSignal) => apiRequest(`/tx/${encodeURIComponent(hash)}`, { decode: decodeExplorerTransactionDetail, signal }),
  address: (address: string, page = 1, limit = 20, signal?: AbortSignal) => apiRequest(`/address/${encodeURIComponent(address)}`, { decode: decodeExplorerAddressDetail, query: { page, limit }, signal }),
  tokens: (page = 1, limit = 20, signal?: AbortSignal) => apiRequest('/tokens', { decode: decodeExplorerTokens, query: { page, limit }, signal }),
  token: (address: string, page = 1, limit = 20, signal?: AbortSignal) => apiRequest(`/token/${encodeURIComponent(address)}`, { decode: decodeExplorerTokenDetail, query: { page, limit }, signal }),
};
