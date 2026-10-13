import { EVENT_TYPES, type ChainReorganizedEvent, type TokenTransferIndexedEvent } from './blockchain.events.js';
import type { EventEnvelope } from './event-envelope.js';
import { isEthereumAddress } from '../utils/ethereum-address.js';

function isUnsignedInteger(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

export function isTokenTransferIndexedEvent(event: EventEnvelope): event is TokenTransferIndexedEvent {
  const data = event.payload;
  return event.type === EVENT_TYPES.TOKEN_TRANSFER_INDEXED && event.version === 1 &&
    typeof data === 'object' && data !== null &&
    'chainId' in data && typeof data.chainId === 'number' && Number.isSafeInteger(data.chainId) && data.chainId > 0 &&
    'networkName' in data && typeof data.networkName === 'string' &&
    'blockNumber' in data && isUnsignedInteger(data.blockNumber) &&
    'transactionHash' in data && typeof data.transactionHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(data.transactionHash) &&
    'transactionIndex' in data && typeof data.transactionIndex === 'number' && Number.isSafeInteger(data.transactionIndex) && data.transactionIndex >= 0 &&
    'logIndex' in data && typeof data.logIndex === 'number' && Number.isSafeInteger(data.logIndex) && data.logIndex >= 0 &&
    'tokenAddress' in data && isEthereumAddress(data.tokenAddress) &&
    'fromAddress' in data && isEthereumAddress(data.fromAddress) &&
    'toAddress' in data && isEthereumAddress(data.toAddress) &&
    'amountRaw' in data && isUnsignedInteger(data.amountRaw) &&
    (!('tokenDecimals' in data) || data.tokenDecimals === undefined ||
      (typeof data.tokenDecimals === 'number' && Number.isInteger(data.tokenDecimals) && data.tokenDecimals >= 0 && data.tokenDecimals <= 255)) &&
    (!('tokenSymbol' in data) || data.tokenSymbol === undefined ||
      (typeof data.tokenSymbol === 'string' && data.tokenSymbol.length <= 64));
}

export function isChainReorganizedEvent(event: EventEnvelope): event is ChainReorganizedEvent {
  const data = event.payload;
  return event.type === EVENT_TYPES.CHAIN_REORGANIZED && event.version === 1 &&
    typeof data === 'object' && data !== null &&
    'chainId' in data && typeof data.chainId === 'number' && Number.isSafeInteger(data.chainId) && data.chainId > 0 &&
    'networkName' in data && typeof data.networkName === 'string' &&
    'detectedAtBlock' in data && isUnsignedInteger(data.detectedAtBlock) &&
    'commonAncestorBlock' in data && isUnsignedInteger(data.commonAncestorBlock) &&
    'commonAncestorHash' in data && (data.commonAncestorHash === null ||
      (typeof data.commonAncestorHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(data.commonAncestorHash)));
}
