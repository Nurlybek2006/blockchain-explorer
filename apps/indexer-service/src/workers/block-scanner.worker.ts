import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import {
  sleep,
} from '@blockchain-explorer/blockchain-client';

import {
  ChainSyncService,
} from '../modules/chain-sync/chain-sync.service.js';

import {
  IndexerConfigService,
} from '../config/indexer-config.service.js';

@Injectable()
export class BlockScannerWorker
  implements
    OnApplicationBootstrap,
    OnApplicationShutdown
{
  private readonly logger =
    new Logger(
      BlockScannerWorker.name,
    );

  private stopping =
    false;

  private loopPromise:
    Promise<void> | null =
    null;

  constructor(
    private readonly chainSync:
      ChainSyncService,

    private readonly config:
      IndexerConfigService,
  ) {}

  onApplicationBootstrap():
    void {
    if (
      !this.config.enabled
    ) {
      this.logger.warn(
        'Blockchain indexer is disabled',
      );

      return;
    }

    this.logger.log(
      'Starting block scanner worker',
    );

    this.loopPromise =
      this.runLoop();
  }

  async onApplicationShutdown():
    Promise<void> {
    this.stopping =
      true;

    if (
      this.loopPromise
    ) {
      await this.loopPromise;
    }

    this.logger.log(
      'Block scanner stopped',
    );
  }

  private async runLoop():
    Promise<void> {
    while (
      !this.stopping
    ) {
      try {
        const processedWork =
          await this.chainSync
            .syncNextBatch();

        if (
          !processedWork
        ) {
          await sleep(
            this.config
              .pollIntervalMs,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.stack ??
              error.message
            : String(error);

        this.logger.error(
          'Block scanner iteration failed',
          message,
        );

        await sleep(
          this.config
            .errorBackoffMs,
        );
      }
    }
  }
}
// Indexer-ді background loop ретінде үздіксіз жүргізеді. Error болса service құламайды, күтіп қайта әрекет жасайды.