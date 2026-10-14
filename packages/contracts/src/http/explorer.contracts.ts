/** Explorer HTTP representation after jsonSafe: bigint and numeric amounts stay strings. */
export interface ExplorerPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ExplorerListResponse<T> {
  data: T[];
  pagination: ExplorerPagination;
}

export interface ExplorerStatsResponse {
  latestBlock: { number: string; timestamp: string } | null;
  blocks: number;
  transactions: number;
  tokens: number;
  tokenTransfers: number;
}

export interface ExplorerBlockResponse {
  number: string;
  hash: string;
  parentHash: string;
  miner: string | null;
  timestamp: string;
  gasLimit: string;
  gasUsed: string;
  baseFeePerGas: string | null;
  size: number | null;
  transactionCount: number;
  transactionsRoot: string | null;
  stateRoot: string | null;
  receiptsRoot: string | null;
  extraData: string | null;
  indexedAt: string;
}

export interface ExplorerTransactionResponse {
  hash: string;
  blockNumber: string;
  blockHash: string;
  transactionIndex: number;
  fromAddress: string;
  toAddress: string | null;
  nonce: string;
  value: string;
  gas: string;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  type: number | null;
  input: string;
  indexedAt: string;
}

export interface ExplorerBlockDetailResponse extends ExplorerBlockResponse {
  transactions: ExplorerTransactionResponse[];
}

export interface ExplorerReceiptResponse {
  transactionHash: string;
  blockNumber: string;
  status: boolean;
  contractAddress: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  effectiveGasPrice: string | null;
  logsBloom: string | null;
}

export interface ExplorerLogResponse {
  id: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
  removed: boolean;
}

export interface ExplorerTokenTransferResponse {
  id: string;
  transactionHash: string;
  blockNumber: string;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  transactionIndex: number;
  logIndex: number;
  removed: boolean;
  indexedAt: string;
}

export interface ExplorerTransactionDetailResponse {
  transaction: ExplorerTransactionResponse;
  receipt: ExplorerReceiptResponse | null;
  logs: ExplorerLogResponse[];
  tokenTransfers: ExplorerTokenTransferResponse[];
}

export interface ExplorerTokenResponse {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  firstSeenBlock: string | null;
  lastUpdatedBlock: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExplorerAddressResponse {
  address: string;
  isContract: boolean;
  /** Legacy registry field; currently defaults to zero and is not a live RPC balance. */
  nativeBalanceWei?: string;
  transactionCount?: string;
  firstSeenBlock?: string | null;
  lastSeenBlock?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExplorerAddressDetailResponse {
  address: ExplorerAddressResponse;
  transactionCount: number;
  tokenTransferCount: number;
  transactions: ExplorerTransactionResponse[];
  /** Recent transfers only; transaction pagination does not offset this array. */
  tokenTransfers: ExplorerTokenTransferResponse[];
  pagination: ExplorerPagination;
}

export interface ExplorerTokenDetailResponse {
  token: ExplorerTokenResponse;
  transfers: ExplorerTokenTransferResponse[];
  pagination: ExplorerPagination;
}

export type ExplorerBlocksResponse = ExplorerListResponse<ExplorerBlockResponse>;
export type ExplorerTokensResponse = ExplorerListResponse<ExplorerTokenResponse>;
