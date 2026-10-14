import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EthereumRpcClient } from '@blockchain-explorer/blockchain-client';
import {
  BullMqFactory,
  type Job,
  type Queue,
  type Worker,
} from '@blockchain-explorer/messaging';
import { isEthereumAddress } from '@blockchain-explorer/contracts';
import { loadAdvancedConfig, type AdvancedConfig } from './advanced.config.js';
import { AdvancedExplorerRepository } from './advanced-explorer.repository.js';
import { ContractDetectionService } from './contract-detection.service.js';
import {
  EtherscanClient,
  VerificationProviderError,
} from './etherscan.client.js';
import {
  isUnsupportedTraceError,
  normalizeCallTrace,
} from './trace-normalizer.js';

export interface VerificationJobData {
  contractAddress: string;
  blockNumber: string;
  blockHash?: string;
  attempt: number;
  transactionHash?: string;
}
export interface TraceJobData {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
}
function verificationData(value: unknown): value is VerificationJobData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'contractAddress' in value &&
    isEthereumAddress(value.contractAddress) &&
    'blockNumber' in value &&
    typeof value.blockNumber === 'string' &&
    /^\d+$/.test(value.blockNumber) &&
    'attempt' in value &&
    typeof value.attempt === 'number' &&
    Number.isInteger(value.attempt) &&
    value.attempt >= 0 &&
    (!('blockHash' in value) ||
      value.blockHash === undefined ||
      (typeof value.blockHash === 'string' &&
        /^0x[0-9a-fA-F]{64}$/.test(value.blockHash))) &&
    (!('transactionHash' in value) ||
      value.transactionHash === undefined ||
      (typeof value.transactionHash === 'string' &&
        /^0x[0-9a-fA-F]{64}$/.test(value.transactionHash)))
  );
}
function traceData(value: unknown): value is TraceJobData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'transactionHash' in value &&
    typeof value.transactionHash === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(value.transactionHash) &&
    'blockHash' in value &&
    typeof value.blockHash === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(value.blockHash) &&
    'blockNumber' in value &&
    typeof value.blockNumber === 'string' &&
    /^\d+$/.test(value.blockNumber)
  );
}

@Injectable()
export class AdvancedJobsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AdvancedJobsService.name);
  private readonly options: AdvancedConfig;
  private readonly factory: BullMqFactory;
  private readonly traceRpc: EthereumRpcClient;
  private verificationQueue: Queue<
    VerificationJobData,
    void,
    'verify-contract'
  > | null = null;
  private traceQueue: Queue<TraceJobData, void, 'trace-transaction'> | null =
    null;
  private verificationWorker: Worker<
    VerificationJobData,
    void,
    'verify-contract'
  > | null = null;
  private traceWorker: Worker<TraceJobData, void, 'trace-transaction'> | null =
    null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: Promise<void> | null = null;
  private stopping = false;
  private traceUnsupported = false;

  constructor(
    private readonly repository: AdvancedExplorerRepository,
    private readonly detection: ContractDetectionService,
    private readonly etherscan: EtherscanClient,
    config: ConfigService,
  ) {
    this.options = loadAdvancedConfig(config);
    this.factory = new BullMqFactory({ redisUrl: this.options.redisUrl });
    this.traceRpc = new EthereumRpcClient({
      url: config.getOrThrow<string>('ETHEREUM_RPC_URL'),
      timeoutMs: this.options.traceTimeoutMs,
      maxRetries: 0,
      maxConcurrentRequests: this.options.traceConcurrency,
      requestsPerSecond: Math.max(1, this.options.traceConcurrency),
    });
  }
  onApplicationBootstrap(): void {
    if (!this.options.dispatcherEnabled) return;
    if (this.options.verificationEnabled) {
      this.verificationQueue = this.factory.createQueue<
        VerificationJobData,
        void,
        'verify-contract'
      >(`${this.options.queuePrefix}-verification`, { attempts: 1 });
      this.verificationQueue.on('error', () =>
        this.logger.warn(
          'Verification queue unavailable; durable intents remain pending',
        ),
      );
      const worker = this.factory.createWorker<
        VerificationJobData,
        void,
        'verify-contract'
      >(
        `${this.options.queuePrefix}-verification`,
        (job) => this.verify(job),
        1,
      );
      worker.on('error', () =>
        this.logger.warn('Verification worker connection unavailable'),
      );
      worker.on('failed', () =>
        this.logger.warn('Verification job failed; state retained'),
      );
      this.verificationWorker = worker;
    }
    if (this.options.traceEnabled) {
      this.traceQueue = this.factory.createQueue<
        TraceJobData,
        void,
        'trace-transaction'
      >(`${this.options.queuePrefix}-traces`, {
        attempts: this.options.traceMaxRetries + 1,
        backoff: { type: 'exponential', delay: 1000 },
      });
      this.traceQueue.on('error', () =>
        this.logger.warn(
          'Trace queue unavailable; durable intents remain pending',
        ),
      );
      const worker = this.factory.createWorker<
        TraceJobData,
        void,
        'trace-transaction'
      >(
        `${this.options.queuePrefix}-traces`,
        (job) => this.trace(job),
        this.options.traceConcurrency,
      );
      worker.on('error', () =>
        this.logger.warn('Trace worker connection unavailable'),
      );
      worker.on('failed', () =>
        this.logger.warn('Trace job failed; indexing continues'),
      );
      this.traceWorker = worker;
    }
    this.schedule(0);
  }
  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.active = this.dispatch()
        .catch(() =>
          this.logger.warn('Enrichment dispatch failed; indexing continues'),
        )
        .finally(() => {
          this.active = null;
          this.schedule(1000);
        });
    }, delay);
  }
  async dispatch(): Promise<void> {
    // Detection runs alongside queue dispatch so an RPC stall cannot block pending verification/traces.
    await Promise.all([
      this.detection.processBatch(),
      this.dispatchVerification(),
      this.dispatchTraces(),
    ]);
  }
  private async dispatchVerification(): Promise<void> {
    const queue = this.verificationQueue;
    if (!queue) return;
    for (const row of await this.repository.dueVerifications(this.options)) {
      const data: VerificationJobData = {
        contractAddress: row.contractAddress,
        blockNumber: (row.discoveredBlock ?? 0n).toString(),
        ...(row.discoveredBlockHash
          ? { blockHash: row.discoveredBlockHash }
          : {}),
        attempt: row.attempts,
      };
      // BullMQ custom IDs cannot contain colons. Attempt suffix enables bounded delayed rechecks.
      await deadline(
        queue.add('verify-contract', data, {
          jobId: `verify-${row.contractAddress}-${row.discoveredBlockHash ?? 'legacy'}-${row.attempts}`,
        }),
        2500,
      );
      await this.repository.deferVerification(
        row.contractAddress,
        row.attempts,
        new Date(Date.now() + 600000),
      );
    }
  }
  private async dispatchTraces(): Promise<void> {
    const queue = this.traceQueue;
    if (!queue) return;
    for (const row of await this.repository.dueTraces()) {
      if (row.attempts > this.options.traceMaxRetries) {
        await this.repository.failTrace(
          row,
          false,
          this.options.traceMaxRetries + 1,
        );
        continue;
      }
      const data: TraceJobData = {
        transactionHash: row.transactionHash,
        blockNumber: row.blockNumber.toString(),
        blockHash: row.blockHash,
      };
      const id = `trace-${row.transactionHash}-${row.blockHash}`;
      const existing = await deadline(queue.getJob(id), 2500);
      if (existing) {
        const state = await existing.getState();
        if (state === 'failed') await existing.retry();
        else if (
          state === 'completed' &&
          (row.status === 'queued' || row.status === 'processing')
        ) {
          await existing.remove();
          await deadline(
            queue.add('trace-transaction', data, { jobId: id }),
            2500,
          );
        }
      } else
        await deadline(
          queue.add('trace-transaction', data, { jobId: id }),
          2500,
        );
      await this.repository.deferTrace(
        row.transactionHash,
        row.attempts,
        new Date(Date.now() + 120000),
      );
    }
  }
  async verify(
    job: Job<VerificationJobData, void, 'verify-contract'>,
  ): Promise<void> {
    if (job.name !== 'verify-contract' || !verificationData(job.data))
      throw new Error('Invalid verification job');
    return this.processVerification(job.data);
  }
  async processVerification(data: VerificationJobData): Promise<void> {
    if (!verificationData(data))
      throw new Error('Invalid verification payload');
    const row = await this.repository.claimVerification(
      data.contractAddress.toLowerCase(),
      data.attempt,
      data.blockHash?.toLowerCase() ?? null,
    );
    if (!row) return;
    try {
      await this.repository.completeVerification(
        row.contractAddress,
        await this.etherscan.lookup(row.contractAddress),
        row.attempts,
        this.options,
        row.discoveredBlockHash,
      );
    } catch (error) {
      await this.repository.failVerification(
        row.contractAddress,
        row.attempts,
        error instanceof VerificationProviderError
          ? error.code
          : 'request-failed',
        this.options,
        row.discoveredBlockHash,
      );
    }
  }
  async trace(
    job: Job<TraceJobData, void, 'trace-transaction'>,
  ): Promise<void> {
    if (job.name !== 'trace-transaction' || !traceData(job.data))
      throw new Error('Invalid trace job');
    return this.processTrace(job.data);
  }
  async processTrace(data: TraceJobData): Promise<void> {
    if (!traceData(data)) throw new Error('Invalid trace payload');
    const row = await this.repository.claimTrace(
      data.transactionHash.toLowerCase(),
      data.blockHash.toLowerCase(),
      this.options.traceMaxRetries + 1,
    );
    if (!row) return;
    if (this.traceUnsupported) {
      await this.repository.failTrace(
        row,
        true,
        this.options.traceMaxRetries + 1,
      );
      return;
    }
    try {
      // A hash may be re-included on another branch; callTracer alone does not identify its block.
      const before = await this.traceRpc.getBlockByNumber(
        row.blockNumber,
        false,
      );
      if (before?.hash?.toLowerCase() !== row.blockHash)
        throw new Error('Trace provider is not on the indexed canonical block');
      const payload = await this.traceRpc.traceTransaction<unknown>(
        row.transactionHash,
        {
          tracer: 'callTracer',
          timeout: `${Math.ceil(this.options.traceTimeoutMs / 1000)}s`,
        },
      );
      const after = await this.traceRpc.getBlockByNumber(
        row.blockNumber,
        false,
      );
      if (after?.hash?.toLowerCase() !== row.blockHash)
        throw new Error('Trace provider changed branch during tracing');
      const current = await this.repository.getTransaction(row.transactionHash);
      if (!current || current.blockHash !== row.blockHash) return;
      await this.repository.completeTrace(
        row,
        normalizeCallTrace(payload, row.transactionHash, row.blockNumber),
      );
    } catch (error) {
      const unsupported = isUnsupportedTraceError(error);
      if (unsupported) this.traceUnsupported = true;
      await this.repository.failTrace(
        row,
        unsupported,
        this.options.traceMaxRetries + 1,
      );
      if (!unsupported) throw new Error('Trace request failed');
    }
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.detection.stop();
    this.etherscan.onModuleDestroy();
    this.traceRpc.close();
    await this.active;
    await Promise.all([
      this.verificationWorker?.close(),
      this.traceWorker?.close(),
    ]);
    await Promise.all([
      this.verificationQueue?.close(),
      this.traceQueue?.close(),
    ]);
  }
}

async function deadline<T>(
  operation: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Enrichment enqueue timed out')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
