import { EVENT_TYPES, isChainReorganizedEvent, isTokenTransferIndexedEvent, type EventEnvelope, type RealtimeExplorerEvent } from '@blockchain-explorer/contracts';

function integer(value: unknown): value is string { return typeof value === 'string' && /^\d{1,78}$/.test(value); }
function hash(value: unknown): value is string { return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value); }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function timestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }

/** Explicit allowlist prevents internal envelope and arbitrary payload fields reaching browsers. */
export function mapRealtimeEvent(event: EventEnvelope, chainId: number): RealtimeExplorerEvent | null {
  if (!event.id || event.id.length > 128 || !timestamp(event.occurredAt) || event.version !== 1) return null;
  const { id, occurredAt } = event;
  if (isTokenTransferIndexedEvent(event)) {
    const p = event.payload;
    if (p.chainId !== chainId || p.networkName.length > 100 || p.amountRaw.length > 78 || p.blockNumber.length > 78) return null;
    return { id, type: 'token.transfer.indexed', occurredAt, payload: {
      chainId: p.chainId, networkName: p.networkName, blockNumber: p.blockNumber,
      transactionHash: p.transactionHash.toLowerCase(), transactionIndex: p.transactionIndex, logIndex: p.logIndex,
      tokenAddress: p.tokenAddress.toLowerCase(), fromAddress: p.fromAddress.toLowerCase(), toAddress: p.toAddress.toLowerCase(), amountRaw: p.amountRaw,
    } };
  }
  if (isChainReorganizedEvent(event)) {
    const p = event.payload;
    if (p.chainId !== chainId || p.networkName.length > 100 || p.detectedAtBlock.length > 78 || p.commonAncestorBlock.length > 78) return null;
    return { id, type: 'chain.reorganized', occurredAt, payload: {
      chainId: p.chainId, networkName: p.networkName, detectedAtBlock: p.detectedAtBlock,
      commonAncestorBlock: p.commonAncestorBlock, commonAncestorHash: p.commonAncestorHash?.toLowerCase() ?? null,
    } };
  }
  const p = event.payload;
  if (event.type !== EVENT_TYPES.BLOCK_INDEXED || typeof p !== 'object' || p === null) return null;
  if (!('chainId' in p) || p.chainId !== chainId || !('networkName' in p) || typeof p.networkName !== 'string' || p.networkName.length > 100
    || !('blockNumber' in p) || !integer(p.blockNumber) || !('blockHash' in p) || !hash(p.blockHash)
    || !('parentHash' in p) || !hash(p.parentHash) || !('timestamp' in p) || !timestamp(p.timestamp)
    || !('transactionCount' in p) || !count(p.transactionCount) || !('logCount' in p) || !count(p.logCount)
    || !('tokenTransferCount' in p) || !count(p.tokenTransferCount)) return null;
  return { id, type: 'block.indexed', occurredAt, payload: {
    chainId, networkName: p.networkName, blockNumber: p.blockNumber, blockHash: p.blockHash.toLowerCase(), parentHash: p.parentHash.toLowerCase(),
    timestamp: p.timestamp, transactionCount: p.transactionCount, logCount: p.logCount, tokenTransferCount: p.tokenTransferCount,
  } };
}

/** At-least-once broker delivery suppression, with bounded memory and expiry. */
export class RealtimeDeduplicator {
  private readonly entries = new Map<string, number>();
  constructor(private readonly capacity = 2_000, private readonly ttlMs = 300_000) {}
  accept(id: string, now = Date.now()): boolean {
    const expires = this.entries.get(id);
    if (expires !== undefined && expires > now) return false;
    this.entries.delete(id);
    for (const [key, until] of this.entries) {
      if (until > now && this.entries.size < this.capacity) break;
      this.entries.delete(key);
    }
    this.entries.set(id, now + this.ttlMs);
    return true;
  }
}
