import {
  Module,
} from '@nestjs/common';

import {
  RpcModule,
} from '../rpc/rpc.module.js';

import {
  TokenIndexingService,
} from './token-indexing.service.js';

@Module({
  imports: [
    RpcModule,
  ],

  providers: [
    TokenIndexingService,
  ],

  exports: [
    TokenIndexingService,
  ],
})
export class TokensModule {}
// Token indexing логикасын жеке NestJS module ретінде бөледі.