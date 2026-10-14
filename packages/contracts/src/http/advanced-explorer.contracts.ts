/** All block heights and Ethereum quantities stay decimal strings. */
export type ContractVerificationStatus =
  "verified" | "unverified" | "pending" | "unsupported" | "failed";
export type TransactionTraceStatus =
  | "not_requested"
  | "queued"
  | "processing"
  | "completed"
  | "unsupported"
  | "failed";

export interface ContractVerificationResponse {
  status: ContractVerificationStatus;
  verified: boolean;
  contractName: string | null;
  compilerVersion: string | null;
  optimizationUsed: boolean | null;
  optimizationRuns: number | null;
  sourceCode: string | null;
  abi: unknown[] | null;
  constructorArguments: string | null;
  verificationSource: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
}

export interface ContractDetailResponse {
  address: string;
  isContract: true;
  firstSeenBlock: string | null;
  lastSeenBlock: string | null;
  verification: ContractVerificationResponse;
}

export interface TransactionTraceEntry {
  transactionHash: string;
  blockNumber: string;
  traceAddress: string;
  depth: number;
  type: string;
  callType: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  value: string | null;
  gas: string | null;
  gasUsed: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
  /** Excludes the root, failed calls and delegated/static execution values. */
  valueBearing: boolean;
}

export interface TransactionTraceResponse {
  transactionHash: string;
  available: boolean;
  status: TransactionTraceStatus;
  reason:
    | "not-supported"
    | "not-indexed"
    | "pending"
    | "failed"
    | "not-requested"
    | null;
  traces: TransactionTraceEntry[];
  internalCalls: TransactionTraceEntry[];
  updatedAt: string | null;
}

export interface ExplorerSearchResponse {
  type: "block" | "transaction" | "address" | "contract" | "token";
  value: string;
  destination: string;
}

export interface NetworkStatusResponse {
  chainId: number;
  networkName: string;
  rpcLatestBlock: string | null;
  indexedBlock: string | null;
  lag: string | null;
  status: "starting" | "syncing" | "synced" | "degraded" | "stopped";
  updatedAt: string;
}
