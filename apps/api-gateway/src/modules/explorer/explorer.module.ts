import {
  Module,
} from '@nestjs/common';

import {
  ExplorerController,
} from './explorer.controller.js';

import {
  IndexerExplorerClient,
} from './indexer-explorer.client.js';

import {
  ExplorerService,
} from './explorer.service.js';

@Module({
  controllers: [
    ExplorerController,
  ],

  providers: [
    IndexerExplorerClient,

    ExplorerService,
  ],

  exports: [
    ExplorerService,
  ],
})
export class ExplorerModule {}