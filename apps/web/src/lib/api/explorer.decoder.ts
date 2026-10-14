import type {
  ExplorerAddressDetailResponse, ExplorerAddressResponse, ExplorerBlockDetailResponse,
  ExplorerBlockResponse, ExplorerBlocksResponse, ExplorerLogResponse, ExplorerPagination,
  ExplorerReceiptResponse, ExplorerStatsResponse, ExplorerTokenDetailResponse,
  ExplorerTokenResponse, ExplorerTokensResponse, ExplorerTokenTransferResponse,
  ExplorerTransactionDetailResponse, ExplorerTransactionResponse,
} from '@blockchain-explorer/contracts/browser';
import { isEthereumAddress } from '@blockchain-explorer/contracts/browser';
import { ContractError, readArray, readBoolean, readInteger, readNullableString, readRecord, readString } from './fields';

function invalid(): never { throw new ContractError('The Explorer response did not match its contract.'); }
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const n = readInteger(value);
  if (n < 0 || n > maximum) return invalid();
  return n;
}
function nullableInteger(value: unknown, maximum?: number): number | null { return value === null ? null : integer(value, maximum); }
function amount(value: unknown): string { const text = readString(value); return /^\d+$/.test(text) ? text : invalid(); }
function nullableAmount(value: unknown): string | null { return value === null ? null : amount(value); }
function address(value: unknown): string { return isEthereumAddress(value) ? value : invalid(); }
function nullableAddress(value: unknown): string | null { return value === null ? null : address(value); }
function hash(value: unknown): string { const text = readString(value); return /^0x[0-9a-fA-F]{64}$/.test(text) ? text : invalid(); }
function nullableHash(value: unknown): string | null { return value === null ? null : hash(value); }
function timestamp(value: unknown): string { const text = readString(value); return Number.isFinite(Date.parse(text)) ? text : invalid(); }

export function decodeExplorerPagination(value: unknown): ExplorerPagination {
  const b = readRecord(value);
  const page = integer(b.page); const limit = integer(b.limit, 100);
  const total = integer(b.total); const totalPages = integer(b.totalPages);
  if (page < 1 || limit < 1 || totalPages !== Math.ceil(total / limit)) return invalid();
  return { page, limit, total, totalPages };
}

export function decodeExplorerStats(value: unknown): ExplorerStatsResponse {
  const b = readRecord(value); const latest = b.latestBlock === null ? null : readRecord(b.latestBlock);
  return { latestBlock: latest === null ? null : { number: amount(latest.number), timestamp: timestamp(latest.timestamp) }, blocks: integer(b.blocks), transactions: integer(b.transactions), tokens: integer(b.tokens), tokenTransfers: integer(b.tokenTransfers) };
}

export function decodeExplorerBlock(value: unknown): ExplorerBlockResponse {
  const b = readRecord(value);
  return { number: amount(b.number), hash: hash(b.hash), parentHash: hash(b.parentHash), miner: nullableAddress(b.miner), timestamp: timestamp(b.timestamp), gasLimit: amount(b.gasLimit), gasUsed: amount(b.gasUsed), baseFeePerGas: nullableAmount(b.baseFeePerGas), size: nullableInteger(b.size), transactionCount: integer(b.transactionCount), transactionsRoot: nullableHash(b.transactionsRoot), stateRoot: nullableHash(b.stateRoot), receiptsRoot: nullableHash(b.receiptsRoot), extraData: readNullableString(b.extraData), indexedAt: timestamp(b.indexedAt) };
}

export function decodeExplorerTransaction(value: unknown): ExplorerTransactionResponse {
  const b = readRecord(value);
  return { hash: hash(b.hash), blockNumber: amount(b.blockNumber), blockHash: hash(b.blockHash), transactionIndex: integer(b.transactionIndex), fromAddress: address(b.fromAddress), toAddress: nullableAddress(b.toAddress), nonce: amount(b.nonce), value: amount(b.value), gas: amount(b.gas), gasPrice: nullableAmount(b.gasPrice), maxFeePerGas: nullableAmount(b.maxFeePerGas), maxPriorityFeePerGas: nullableAmount(b.maxPriorityFeePerGas), type: nullableInteger(b.type), input: readString(b.input), indexedAt: timestamp(b.indexedAt) };
}

export function decodeExplorerBlocks(value: unknown): ExplorerBlocksResponse {
  const b = readRecord(value);
  return { data: readArray(b.data, decodeExplorerBlock), pagination: decodeExplorerPagination(b.pagination) };
}

export function decodeExplorerBlockDetail(value: unknown): ExplorerBlockDetailResponse {
  const b = readRecord(value);
  return { ...decodeExplorerBlock(b), transactions: readArray(b.transactions, decodeExplorerTransaction) };
}

function decodeExplorerReceipt(value: unknown): ExplorerReceiptResponse {
  const b = readRecord(value);
  return { transactionHash: hash(b.transactionHash), blockNumber: amount(b.blockNumber), status: readBoolean(b.status), contractAddress: nullableAddress(b.contractAddress), cumulativeGasUsed: amount(b.cumulativeGasUsed), gasUsed: amount(b.gasUsed), effectiveGasPrice: nullableAmount(b.effectiveGasPrice), logsBloom: readNullableString(b.logsBloom) };
}
function decodeExplorerLog(value: unknown): ExplorerLogResponse {
  const b = readRecord(value);
  return { id: readString(b.id), transactionHash: hash(b.transactionHash), blockNumber: amount(b.blockNumber), logIndex: integer(b.logIndex), address: address(b.address), topic0: nullableHash(b.topic0), topic1: nullableHash(b.topic1), topic2: nullableHash(b.topic2), topic3: nullableHash(b.topic3), data: readString(b.data), removed: readBoolean(b.removed) };
}
export function decodeExplorerTransfer(value: unknown): ExplorerTokenTransferResponse {
  const b = readRecord(value);
  return { id: readString(b.id), transactionHash: hash(b.transactionHash), blockNumber: amount(b.blockNumber), tokenAddress: address(b.tokenAddress), fromAddress: address(b.fromAddress), toAddress: address(b.toAddress), amount: amount(b.amount), transactionIndex: integer(b.transactionIndex), logIndex: integer(b.logIndex), removed: readBoolean(b.removed), indexedAt: timestamp(b.indexedAt) };
}
export function decodeExplorerTransactionDetail(value: unknown): ExplorerTransactionDetailResponse {
  const b = readRecord(value);
  return { transaction: decodeExplorerTransaction(b.transaction), receipt: b.receipt === null ? null : decodeExplorerReceipt(b.receipt), logs: readArray(b.logs, decodeExplorerLog), tokenTransfers: readArray(b.tokenTransfers, decodeExplorerTransfer) };
}
export function decodeExplorerToken(value: unknown): ExplorerTokenResponse {
  const b = readRecord(value);
  return { address: address(b.address), name: readNullableString(b.name), symbol: readNullableString(b.symbol), decimals: nullableInteger(b.decimals, 255), totalSupply: nullableAmount(b.totalSupply), firstSeenBlock: nullableAmount(b.firstSeenBlock), lastUpdatedBlock: nullableAmount(b.lastUpdatedBlock), createdAt: timestamp(b.createdAt), updatedAt: timestamp(b.updatedAt) };
}
export function decodeExplorerTokens(value: unknown): ExplorerTokensResponse {
  const b = readRecord(value);
  return { data: readArray(b.data, decodeExplorerToken), pagination: decodeExplorerPagination(b.pagination) };
}
export function decodeExplorerTokenDetail(value: unknown): ExplorerTokenDetailResponse {
  const b = readRecord(value);
  return { token: decodeExplorerToken(b.token), transfers: readArray(b.transfers, decodeExplorerTransfer), pagination: decodeExplorerPagination(b.pagination) };
}
function decodeExplorerAddress(value: unknown): ExplorerAddressResponse {
  const b = readRecord(value);
  return { address: address(b.address), isContract: readBoolean(b.isContract),
    ...(b.nativeBalanceWei === undefined ? {} : { nativeBalanceWei: amount(b.nativeBalanceWei) }),
    ...(b.transactionCount === undefined ? {} : { transactionCount: amount(b.transactionCount) }),
    ...(b.firstSeenBlock === undefined ? {} : { firstSeenBlock: nullableAmount(b.firstSeenBlock) }),
    ...(b.lastSeenBlock === undefined ? {} : { lastSeenBlock: nullableAmount(b.lastSeenBlock) }),
    ...(b.createdAt === undefined ? {} : { createdAt: timestamp(b.createdAt) }),
    ...(b.updatedAt === undefined ? {} : { updatedAt: timestamp(b.updatedAt) }),
  };
}
export function decodeExplorerAddressDetail(value: unknown): ExplorerAddressDetailResponse {
  const b = readRecord(value);
  return { address: decodeExplorerAddress(b.address), transactionCount: integer(b.transactionCount), tokenTransferCount: integer(b.tokenTransferCount), transactions: readArray(b.transactions, decodeExplorerTransaction), tokenTransfers: readArray(b.tokenTransfers, decodeExplorerTransfer), pagination: decodeExplorerPagination(b.pagination) };
}
