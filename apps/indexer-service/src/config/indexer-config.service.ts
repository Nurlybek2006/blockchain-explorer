import {
  Injectable,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

@Injectable()
export class IndexerConfigService {
  constructor(
    private readonly config:
      ConfigService,
  ) {}

  get enabled(): boolean {
    return this.getBoolean(
      'INDEXER_ENABLED',
      true,
    );
  }

  get expectedChainId():
    number {
    return this.getInteger(
      'ETHEREUM_CHAIN_ID',
      11155111,
    );
  }

  get startBlock():
    'latest' | bigint {
    const value =
      this.config
        .get<string>(
          'INDEXER_START_BLOCK',
        )
        ?.trim()
        .toLowerCase() ??
      'latest';

    if (
      value === 'latest'
    ) {
      return 'latest';
    }

    const block =
      BigInt(value);

    if (
      block < 0n
    ) {
      throw new Error(
        'INDEXER_START_BLOCK cannot be negative',
      );
    }

    return block;
  }

  get confirmations():
    number {
    return this.getInteger(
      'INDEXER_CONFIRMATIONS',
      2,
      0,
    );
  }

  get batchSize():
    number {
    return this.getInteger(
      'INDEXER_BATCH_SIZE',
      5,
      1,
    );
  }

  get pollIntervalMs():
    number {
    return this.getInteger(
      'INDEXER_POLL_INTERVAL_MS',
      12_000,
      1000,
    );
  }

  get errorBackoffMs():
    number {
    return this.getInteger(
      'INDEXER_ERROR_BACKOFF_MS',
      5000,
      1000,
    );
  }

  get receiptConcurrency():
    number {
    return this.getInteger(
      'INDEXER_RECEIPT_CONCURRENCY',
      8,
      1,
    );
  }

  get checkpointInterval():
    number {
    return this.getInteger(
      'INDEXER_CHECKPOINT_INTERVAL',
      100,
      1,
    );
  }

  get reorgMaxDepth():
    number {
    return this.getInteger(
      'INDEXER_REORG_MAX_DEPTH',
      64,
      1,
    );
  }

  private getBoolean(
    key: string,
    fallback: boolean,
  ): boolean {
    const value =
      this.config.get<string>(
        key,
      );

    if (
      value === undefined
    ) {
      return fallback;
    }

    return (
      value.toLowerCase() ===
      'true'
    );
  }

  private getInteger(
    key: string,
    fallback: number,
    minimum = 0,
  ): number {
    const raw =
      this.config.get<string>(
        key,
      );

    const value =
      raw === undefined
        ? fallback
        : Number(raw);

    if (
      !Number.isInteger(
        value,
      ) ||
      value < minimum
    ) {
      throw new Error(
        `${key} must be an integer >= ${minimum}`,
      );
    }

    return value;
  }
}
// Indexer-дің барлық .env параметрлерін бір жерден type-safe оқиды.