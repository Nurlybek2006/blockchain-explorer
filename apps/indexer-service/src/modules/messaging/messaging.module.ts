import {
  Module,
} from '@nestjs/common';

import {
  IndexerEventFactory,
} from './indexer-event.factory.js';

import {
  RabbitMqPublisherService,
} from './rabbitmq-publisher.service.js';

import {
  OutboxPublisherWorker,
} from '../../workers/outbox-publisher.worker.js';

@Module({
  providers: [
    IndexerEventFactory,

    RabbitMqPublisherService,

    OutboxPublisherWorker,
  ],

  exports: [
    IndexerEventFactory,

    RabbitMqPublisherService,
  ],
})
export class MessagingModule {}