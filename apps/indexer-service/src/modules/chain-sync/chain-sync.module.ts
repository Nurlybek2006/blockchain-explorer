import {
  Module,
} from '@nestjs/common';

import {
  RpcModule,
} from '../rpc/rpc.module.js';

import {
  IndexerConfigService,
} from '../../config/indexer-config.service.js';

import {
  BlockProcessorService,
} from './block-processor.service.js';

import {
  ChainSyncService,
} from './chain-sync.service.js';

import {
  ReorgService,
} from './reorg.service.js';

import {
  SyncStateRepository,
} from './sync-state.repository.js';

import {
  BlockScannerWorker,
} from '../../workers/block-scanner.worker.js';

@Module({
  imports: [
    RpcModule,
  ],

  providers: [
    IndexerConfigService,

    SyncStateRepository,

    BlockProcessorService,

    ReorgService,

    ChainSyncService,

    BlockScannerWorker,
  ],

  exports: [
    ChainSyncService,

    SyncStateRepository,
  ],
})
export class ChainSyncModule {}
// Blockchain indexing-ке қатысты барлық service пен worker-ді бір NestJS module-ға біріктіреді.