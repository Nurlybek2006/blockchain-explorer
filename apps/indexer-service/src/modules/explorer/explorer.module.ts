import {
  Module,
} from '@nestjs/common';

import {
  ExplorerController,
} from './explorer.controller.js';

import {
  ExplorerQueryService,
} from './explorer-query.service.js';

import {
  InternalServiceGuard,
} from '../../common/guards/internal-service.guard.js';

@Module({
  controllers: [
    ExplorerController,
  ],

  providers: [
    ExplorerQueryService,

    InternalServiceGuard,
  ],

  exports: [
    ExplorerQueryService,
  ],
})
export class ExplorerModule {}