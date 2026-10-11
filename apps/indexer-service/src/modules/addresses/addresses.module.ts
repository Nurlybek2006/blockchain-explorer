import {
  Module,
} from '@nestjs/common';

import {
  AddressIndexingService,
} from './address-indexing.service.js';

@Module({
  providers: [
    AddressIndexingService,
  ],

  exports: [
    AddressIndexingService,
  ],
})
export class AddressesModule {}