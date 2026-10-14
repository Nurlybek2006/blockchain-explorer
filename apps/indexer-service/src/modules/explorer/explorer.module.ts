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
import { AdvancedExplorerModule } from '../advanced/advanced-explorer.module.js';
import { NetworkStatusService } from './network-status.service.js';

@Module({
  imports: [AdvancedExplorerModule],
  controllers: [
    ExplorerController,
  ],

  providers: [
    NetworkStatusService,
    ExplorerQueryService,

    InternalServiceGuard,
  ],

  exports: [
    ExplorerQueryService,
  ],
})
export class ExplorerModule {}
