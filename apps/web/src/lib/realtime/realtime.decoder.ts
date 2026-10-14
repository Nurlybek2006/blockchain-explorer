import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts/browser';
import { readAddress, readHash, readQuantity } from '@/lib/api/advanced-explorer.decoder';
import { invalidResponse, readInteger, readRecord, readString, readTimestamp } from '@/lib/api/fields';
export function decodeRealtimeEvent(value: unknown): RealtimeExplorerEvent {
  const b = readRecord(value), p = readRecord(b.payload), id = readString(b.id), occurredAt = readTimestamp(b.occurredAt);
  if (!id || id.length > 255) return invalidResponse('event id');
  const network = { chainId: readInteger(p.chainId), networkName: readString(p.networkName) };
  if (b.type === 'block.indexed') return { id, occurredAt, type: b.type, payload: { ...network, blockNumber: readQuantity(p.blockNumber), blockHash: readHash(p.blockHash), parentHash: readHash(p.parentHash), timestamp: readTimestamp(p.timestamp), transactionCount: readInteger(p.transactionCount), logCount: readInteger(p.logCount), tokenTransferCount: readInteger(p.tokenTransferCount) } };
  if (b.type === 'token.transfer.indexed') return { id, occurredAt, type: b.type, payload: { ...network, blockNumber: readQuantity(p.blockNumber), transactionHash: readHash(p.transactionHash), transactionIndex: readInteger(p.transactionIndex), logIndex: readInteger(p.logIndex), tokenAddress: readAddress(p.tokenAddress), fromAddress: readAddress(p.fromAddress), toAddress: readAddress(p.toAddress), amountRaw: readQuantity(p.amountRaw) } };
  if (b.type === 'chain.reorganized') return { id, occurredAt, type: b.type, payload: { ...network, detectedAtBlock: readQuantity(p.detectedAtBlock), commonAncestorBlock: readQuantity(p.commonAncestorBlock), commonAncestorHash: p.commonAncestorHash === null ? null : readHash(p.commonAncestorHash) } };
  return invalidResponse('live event type');
}
