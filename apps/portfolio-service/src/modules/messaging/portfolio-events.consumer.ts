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
  and,
  eq,
  or,
} from 'drizzle-orm';

import {
  EVENT_TYPES,
  type BlockchainEvent,
  type EventEnvelope,
  type TokenTransferIndexedEvent,
  type ChainReorganizedEvent,
} from '@blockchain-explorer/contracts';

import {
  RabbitMqClient,
} from '@blockchain-explorer/messaging';

import {
  DatabaseService,
} from '../../database/database.service.js';

import {
  portfolios,
  processedEvents,
} from '../../database/schema/index.js';

import {
  PortfolioJobsService,
} from '../jobs/portfolio-jobs.service.js';

@Injectable()
export class PortfolioEventsConsumer
  implements
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger =
    new Logger(
      PortfolioEventsConsumer.name,
    );

  private readonly rabbit:
    RabbitMqClient;

  constructor(
    private readonly database:
      DatabaseService,

    private readonly jobs:
      PortfolioJobsService,

    config:
      ConfigService,
  ) {
    this.rabbit =
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
    await this.rabbit
      .consume(
        {
          queue:
            'portfolio.events',

          routingKeys: [
            EVENT_TYPES
              .BLOCK_INDEXED,

            EVENT_TYPES
              .TOKEN_TRANSFER_INDEXED,

            EVENT_TYPES
              .CHAIN_REORGANIZED,
          ],
        },

        (
          event,
        ) =>
          this.handleEvent(
            event,
          ),
      );

    this.logger.log(
      'Portfolio RabbitMQ consumer started',
    );
  }

  async onModuleDestroy():
    Promise<void> {
    await this.rabbit
      .close();
  }

  private async handleEvent(
    event:
      EventEnvelope,
  ): Promise<void> {
    const alreadyProcessed =
      await this.database.db
        .select({
          eventId:
            processedEvents
              .eventId,
        })
        .from(
          processedEvents,
        )
        .where(
          eq(
            processedEvents
              .eventId,

            event.id,
          ),
        )
        .limit(1);

    if (
      alreadyProcessed.length >
      0
    ) {
      return;
    }

    switch (
      event.type
    ) {
      case EVENT_TYPES
        .TOKEN_TRANSFER_INDEXED:
        await this.handleTransfer(
          event as
            TokenTransferIndexedEvent,
        );
        break;

      case EVENT_TYPES
        .CHAIN_REORGANIZED:
        await this.handleReorg(
          event as
            ChainReorganizedEvent,
        );
        break;

      case EVENT_TYPES
        .BLOCK_INDEXED:
        break;
    }

    await this.database.db
      .insert(
        processedEvents,
      )
      .values({
        eventId:
          event.id,

        eventType:
          event.type,

        processedAt:
          new Date(),
      })
      .onConflictDoNothing();
  }

  private async handleTransfer(
    event:
      TokenTransferIndexedEvent,
  ): Promise<void> {
    const payload =
      event.payload;

    const matchingPortfolios =
      await this.database.db
        .select({
          id:
            portfolios.id,

          walletAddress:
            portfolios
              .walletAddress,
        })
        .from(
          portfolios,
        )
        .where(
          and(
            eq(
              portfolios
                .chainId,

              payload.chainId,
            ),

            or(
              eq(
                portfolios
                  .walletAddress,

                payload
                  .fromAddress,
              ),

              eq(
                portfolios
                  .walletAddress,

                payload
                  .toAddress,
              ),
            ),
          ),
        );

    for (
      const portfolio of
      matchingPortfolios
    ) {
      await this.jobs
        .enqueueTokenSync({
          portfolioId:
            portfolio.id,

          walletAddress:
            portfolio
              .walletAddress,

          tokenAddress:
            payload
              .tokenAddress,

          blockNumber:
            payload
              .blockNumber,

          sourceEventId:
            event.id,
        });
    }
  }

  private async handleReorg(
    event:
      ChainReorganizedEvent,
  ): Promise<void> {
    const allPortfolios =
      await this.database.db
        .select({
          id:
            portfolios.id,
        })
        .from(
          portfolios,
        )
        .where(
          eq(
            portfolios
              .chainId,

            event.payload
              .chainId,
          ),
        );

    for (
      const portfolio of
      allPortfolios
    ) {
      await this.jobs
        .enqueueRebuild({
          portfolioId:
            portfolio.id,

          sourceEventId:
            event.id,
        });
    }
  }
}
// RabbitMQ event-терді қабылдайды, duplicate event-терді processed_events арқылы сүзеді және portfolio-ға қатысты жұмыстарды BullMQ-ға береді.