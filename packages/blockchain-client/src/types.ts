export type Hex = `0x${string}`;

export type BlockTag =
  | 'latest'
  | 'earliest'
  | 'pending'
  | 'safe'
  | 'finalized'
  | bigint
  | number
  | Hex;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

export interface JsonRpcErrorData {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: JsonRpcErrorData;
}

export interface RpcTransaction {
  hash: Hex;

  blockHash: Hex | null;
  blockNumber: Hex | null;
  transactionIndex: Hex | null;

  from: string;
  to: string | null;

  nonce: Hex;

  value: Hex;

  gas: Hex;

  gasPrice?: Hex;

  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;

  input: Hex;

  type?: Hex;

  chainId?: Hex;

  v?: Hex;
  r?: Hex;
  s?: Hex;
}

export interface RpcBlock<
  TTransaction = RpcTransaction,
> {
  number: Hex | null;

  hash: Hex | null;

  parentHash: Hex;

  nonce?: Hex;

  sha3Uncles?: Hex;

  logsBloom?: Hex;

  transactionsRoot?: Hex;

  stateRoot?: Hex;

  receiptsRoot?: Hex;

  miner: string;

  difficulty?: Hex;

  totalDifficulty?: Hex;

  extraData?: Hex;

  size?: Hex;

  gasLimit: Hex;

  gasUsed: Hex;

  timestamp: Hex;

  baseFeePerGas?: Hex;

  transactions: TTransaction[];

  uncles?: Hex[];
}

export interface RpcLog {
  removed: boolean;

  logIndex: Hex | null;

  transactionIndex: Hex | null;

  transactionHash: Hex | null;

  blockHash: Hex | null;

  blockNumber: Hex | null;

  address: string;

  data: Hex;

  topics: Hex[];
}

export interface RpcTransactionReceipt {
  transactionHash: Hex;

  transactionIndex: Hex;

  blockHash: Hex;

  blockNumber: Hex;

  from: string;

  to: string | null;

  cumulativeGasUsed: Hex;

  gasUsed: Hex;

  contractAddress: string | null;

  logs: RpcLog[];

  logsBloom: Hex;

  status?: Hex;

  effectiveGasPrice?: Hex;

  type?: Hex;
}

export interface RpcLogFilter {
  fromBlock?: BlockTag;

  toBlock?: BlockTag;

  address?:
    | string
    | string[];

  topics?: Array<
    | Hex
    | Hex[]
    | null
  >;
}

export interface RpcCallRequest {
  from?: string;

  to: string;

  gas?: Hex;

  gasPrice?: Hex;

  value?: Hex;

  data?: Hex;
}

export interface EthereumRpcClientOptions {
  url: string;

  timeoutMs?: number;

  maxRetries?: number;

  retryBaseDelayMs?: number;

  maxRetryDelayMs?: number;

  maxConcurrentRequests?: number;

  requestsPerSecond?: number;

  userAgent?: string;
}
// Ethereum JSON-RPC жауаптарының TypeScript модельдерін береді. Соның арқасында blockchain деректері any болмайды.