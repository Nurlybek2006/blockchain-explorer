import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EthereumRpcClient } from '@blockchain-explorer/blockchain-client';
import type { NetworkStatusResponse } from '@blockchain-explorer/contracts';
import { desc } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { blocks } from '../../database/schema/index.js';
import { calculateNetworkLag } from './network-status.js';
import { recordGauge } from '@blockchain-explorer/observability';

function metricHeight(value: string | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

@Injectable()
export class NetworkStatusService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NetworkStatusService.name);
  private readonly rpc: EthereumRpcClient;
  private readonly chainId: number;
  private readonly interval: number;
  private readonly enabled: boolean;
  private snapshot: NetworkStatusResponse;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  private stopping = false;
  private chainChecked = false;
  constructor(config: ConfigService, private readonly database: DatabaseService) {
    const integer = (key: string, fallback: number, minimum: number, maximum: number) => {
      const value = Number(config.get(key) ?? fallback);
      if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${key}`);
      return value;
    };
    this.chainId = integer('ETHEREUM_CHAIN_ID', 11155111, 1, Number.MAX_SAFE_INTEGER);
    this.interval = integer('NETWORK_STATUS_INTERVAL_MS', 15000, 1000, 300000);
    this.enabled = String(config.get('INDEXER_ENABLED') ?? 'true').toLowerCase() !== 'false';
    this.rpc = new EthereumRpcClient({ url: config.getOrThrow<string>('ETHEREUM_RPC_URL'),
      timeoutMs: integer('NETWORK_STATUS_TIMEOUT_MS', 2500, 500, 15000), maxRetries: 0,
      maxConcurrentRequests: 1, requestsPerSecond: 1, userAgent: 'blockchain-explorer-network-status/1.0' });
    this.snapshot = { chainId: this.chainId, networkName: this.chainId === 11155111 ? 'ethereum-sepolia' : this.chainId === 1 ? 'ethereum-mainnet' : `ethereum-${this.chainId}`,
      rpcLatestBlock: null, indexedBlock: null, lag: null, status: 'starting', updatedAt: new Date().toISOString() };
    this.observeSnapshot();
  }
  getStatus(): NetworkStatusResponse { return { ...this.snapshot }; }
  onApplicationBootstrap(): void { this.run(); }
  private run(): void {
    if (this.stopping) return;
    this.pending = this.refresh().finally(() => {
      this.pending = null;
      if (!this.stopping) this.timer = setTimeout(() => this.run(), this.interval);
    });
  }
  private async refresh(): Promise<void> {
    try {
      const [row] = await this.database.db.select({ number: blocks.number }).from(blocks).orderBy(desc(blocks.number)).limit(1);
      const indexedBlock = row?.number.toString() ?? null;
      this.snapshot = { ...this.snapshot, indexedBlock };
      if (!this.chainChecked) {
        if (await this.rpc.getChainId() !== this.chainId) throw new Error('Network mismatch');
        this.chainChecked = true;
      }
      const rpcLatestBlock = (await this.rpc.getBlockNumber()).toString();
      const lag = calculateNetworkLag(rpcLatestBlock, indexedBlock);
      this.snapshot = { ...this.snapshot, rpcLatestBlock, lag,
        status: !this.enabled ? 'stopped' : indexedBlock === null ? 'syncing' : lag === null ? 'degraded' : lag === '0' ? 'synced' : 'syncing', updatedAt: new Date().toISOString() };
    } catch {
      this.snapshot = { ...this.snapshot, rpcLatestBlock: null, lag: null, status: 'degraded', updatedAt: new Date().toISOString() };
      this.logger.warn('Network status probe unavailable');
    } finally {
      this.observeSnapshot();
    }
  }
  private observeSnapshot(): void {
    // Unknown observations remove the datapoint; provider failure must not leave a stale healthy lag.
    recordGauge('indexer_latest_indexed_block', metricHeight(this.snapshot.indexedBlock));
    recordGauge('indexer_rpc_latest_block', metricHeight(this.snapshot.rpcLatestBlock));
    recordGauge('indexer_lag_blocks', metricHeight(this.snapshot.lag));
  }
  async onApplicationShutdown(): Promise<void> { this.stopping = true; if (this.timer) clearTimeout(this.timer); this.rpc.close(); await this.pending; }
}
