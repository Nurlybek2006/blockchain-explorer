import { ConfigService } from '@nestjs/config';
import type {
  RpcBlock,
  RpcTransaction,
  RpcTransactionReceipt,
} from '@blockchain-explorer/blockchain-client';
import { DatabaseService } from '../../database/database.service.js';
import { AdvancedExplorerRepository } from './advanced-explorer.repository.js';
import type {
  addresses,
  contractVerifications,
  transactions,
  transactionTraceRequests,
} from '../../database/schema/index.js';

export const ADDRESS = `0x${'a'.repeat(40)}`;
export const OTHER_ADDRESS = `0x${'b'.repeat(40)}`;
export const HASH = `0x${'c'.repeat(64)}`;
export const BLOCK_HASH = `0x${'d'.repeat(64)}`;
export function testConfig(
  overrides: Record<string, unknown> = {},
): ConfigService {
  return new ConfigService({
    EXPLORER_DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    ETHEREUM_RPC_URL: 'http://127.0.0.1:1/rpc',
    ETHEREUM_CHAIN_ID: 11155111,
    ETHERSCAN_MAX_RETRIES: 0,
    ETHERSCAN_REQUESTS_PER_SECOND: 10,
    EXPLORER_ENRICHMENT_ENABLED: false,
    ...overrides,
  });
}
export function testRepository(): AdvancedExplorerRepository {
  return new AdvancedExplorerRepository(new DatabaseService(testConfig()));
}
export function registry(
  overrides: Partial<typeof addresses.$inferSelect> = {},
): typeof addresses.$inferSelect {
  return {
    address: ADDRESS,
    isContract: true,
    nativeBalanceWei: '0',
    transactionCount: '0',
    firstSeenBlock: 1n,
    lastSeenBlock: 2n,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    codeCheckedBlock: 1n,
    codeCheckAfter: null,
    codeCheckAttempts: 0,
    ...overrides,
  };
}
export function verification(
  overrides: Partial<typeof contractVerifications.$inferSelect> = {},
): typeof contractVerifications.$inferSelect {
  return {
    contractAddress: ADDRESS,
    status: 'pending',
    contractName: null,
    compilerVersion: null,
    optimizationUsed: null,
    optimizationRuns: null,
    sourceCode: null,
    abi: null,
    constructorArguments: null,
    verificationSource: 'etherscan-v2',
    verifiedAt: null,
    discoveredBlock: 1n,
    discoveredBlockHash: BLOCK_HASH,
    lastCheckedAt: null,
    nextAttemptAt: new Date(0),
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}
export function transaction(
  overrides: Partial<typeof transactions.$inferSelect> = {},
): typeof transactions.$inferSelect {
  return {
    hash: HASH,
    blockNumber: 9007199254740993n,
    blockHash: BLOCK_HASH,
    transactionIndex: 0,
    fromAddress: OTHER_ADDRESS,
    toAddress: ADDRESS,
    nonce: '1',
    value: '900719925474099312345678',
    gas: '21000',
    gasPrice: '1',
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    type: 2,
    input: '0x12345678',
    indexedAt: new Date(0),
    ...overrides,
  };
}
export function traceRequest(
  overrides: Partial<typeof transactionTraceRequests.$inferSelect> = {},
): typeof transactionTraceRequests.$inferSelect {
  return {
    transactionHash: HASH,
    blockNumber: 9007199254740993n,
    blockHash: BLOCK_HASH,
    status: 'queued',
    attempts: 0,
    availableAt: new Date(0),
    lastError: null,
    updatedAt: new Date(0),
    ...overrides,
  };
}
export const rpcTransaction: RpcTransaction = {
  hash: `0x${'c'.repeat(64)}`,
  blockHash: `0x${'d'.repeat(64)}`,
  blockNumber: '0x1',
  transactionIndex: '0x0',
  from: OTHER_ADDRESS,
  to: ADDRESS,
  nonce: '0x1',
  value: '0x1',
  gas: '0x5208',
  input: '0x',
};
export const rpcBlock: RpcBlock<RpcTransaction> = {
  number: '0x1',
  hash: `0x${'d'.repeat(64)}`,
  parentHash: `0x${'e'.repeat(64)}`,
  miner: OTHER_ADDRESS,
  gasLimit: '0x100000',
  gasUsed: '0x5208',
  timestamp: '0x1',
  transactions: [rpcTransaction],
};
export const rpcReceipt: RpcTransactionReceipt = {
  transactionHash: `0x${'c'.repeat(64)}`,
  transactionIndex: '0x0',
  blockHash: `0x${'d'.repeat(64)}`,
  blockNumber: '0x1',
  from: OTHER_ADDRESS,
  to: ADDRESS,
  cumulativeGasUsed: '0x5208',
  gasUsed: '0x5208',
  contractAddress: null,
  logs: [],
  logsBloom: '0x',
  status: '0x1',
};
export const verifiedPayload = {
  status: '1',
  message: 'OK',
  result: [
    {
      SourceCode: 'pragma solidity ^0.8.20; contract Example {}',
      ABI: '[{"type":"function","name":"transfer","inputs":[]}]',
      ContractName: 'Example',
      CompilerVersion: 'v0.8.20',
      OptimizationUsed: '1',
      Runs: '200',
      ConstructorArguments: '',
    },
  ],
};
