import {
  Module,
} from '@nestjs/common';

import {
  ExplorerController,
} from './explorer.controller.js';

import {
  IndexerExplorerClient,
} from './indexer-explorer.client.js';

@Module({
  controllers: [
    ExplorerController,
  ],

  providers: [
    IndexerExplorerClient,
  ],

  exports: [
    IndexerExplorerClient,
  ],
})
export class ExplorerModule {}