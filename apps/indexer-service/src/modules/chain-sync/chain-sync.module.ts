import {
  Module,
} from '@nestjs/common';

import {
  RpcModule,
} from '../rpc/rpc.module.js';

import {
  TokensModule,
} from '../tokens/tokens.module.js';

import {
  AddressesModule,
} from '../addresses/addresses.module.js';

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

import {
  MessagingModule,
} from '../messaging/messaging.module.js';

@Module({
  imports: [
    RpcModule,

    TokensModule,

    AddressesModule,

    MessagingModule,
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