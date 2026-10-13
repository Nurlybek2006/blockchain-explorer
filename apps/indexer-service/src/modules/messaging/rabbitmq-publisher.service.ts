import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  RabbitMqClient,
} from '@blockchain-explorer/messaging';

import type {
  EventEnvelope,
} from '@blockchain-explorer/contracts';

@Injectable()
export class RabbitMqPublisherService
  implements
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger =
    new Logger(
      RabbitMqPublisherService.name,
    );

  private readonly client:
    RabbitMqClient;

  constructor(
    config:
      ConfigService,
  ) {
    this.client =
      new RabbitMqClient({
        url:
          config
            .getOrThrow<string>(
              'RABBITMQ_URL',
            ),

        exchange:
          config.get<string>(
            'RABBITMQ_EXCHANGE',
          ) ??
          'blockchain.events',

        prefetch:
          Number(
            config.get(
              'RABBITMQ_PREFETCH',
            ) ??
              20,
          ),
      });
  }

  async onModuleInit():
    Promise<void> {
    await this.client
      .connect();

    this.logger.log(
      'RabbitMQ publisher connected',
    );
  }

  publish(
    event:
      EventEnvelope,
  ): Promise<void> {
    return this.client
      .publish(
        event,
      );
  }

  async onModuleDestroy():
    Promise<void> {
    await this.client
      .close();
  }
}