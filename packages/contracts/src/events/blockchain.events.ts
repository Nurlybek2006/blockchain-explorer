import type {
  EventEnvelope,
} from './event-envelope.js';

export const EVENT_TYPES = {
  BLOCK_INDEXED:
    'block.indexed.v1',

  TOKEN_TRANSFER_INDEXED:
    'token.transfer.indexed.v1',

  CHAIN_REORGANIZED:
    'chain.reorganized.v1',
} as const;

export type BlockchainEventType =
  typeof EVENT_TYPES[
    keyof typeof EVENT_TYPES
  ];


export interface BlockIndexedPayload {
  chainId: number;

  networkName: string;

  blockNumber: string;

  blockHash: string;

  parentHash: string;

  timestamp: string;

  transactionCount: number;

  logCount: number;

  tokenTransferCount: number;
}

export type BlockIndexedEvent =
  EventEnvelope<
    typeof EVENT_TYPES.BLOCK_INDEXED,
    BlockIndexedPayload
  >;


export interface TokenTransferIndexedPayload {
  chainId: number;

  networkName: string;

  blockNumber: string;

  transactionHash: string;

  transactionIndex: number;

  logIndex: number;

  tokenAddress: string;

  fromAddress: string;

  toAddress: string;

  amountRaw: string;
}

export type TokenTransferIndexedEvent =
  EventEnvelope<
    typeof EVENT_TYPES.TOKEN_TRANSFER_INDEXED,
    TokenTransferIndexedPayload
  >;


export interface ChainReorganizedPayload {
  chainId: number;

  networkName: string;

  detectedAtBlock: string;

  commonAncestorBlock: string;

  commonAncestorHash:
    string | null;
}

export type ChainReorganizedEvent =
  EventEnvelope<
    typeof EVENT_TYPES.CHAIN_REORGANIZED,
    ChainReorganizedPayload
  >;


export type BlockchainEvent =
  | BlockIndexedEvent
  | TokenTransferIndexedEvent
  | ChainReorganizedEvent;
//   Indexer мен Portfolio арасындағы event форматтарын нақты анықтайды. Енді екі service бір event contract қолданады.