import amqp from 'amqplib';

import type {
  ConfirmChannel,
  ConsumeMessage,
} from 'amqplib';

import {
  isEventEnvelope,
  type EventEnvelope,
} from '@blockchain-explorer/contracts';

export interface RabbitMqClientOptions {
  url: string;

  exchange?: string;

  prefetch?: number;

  connectionTimeoutMs?: number;
}

export interface RabbitConsumerOptions {
  queue: string;

  routingKeys: string[];

  deadLetterQueue?: string;

  /** Default durable subscriptions are unchanged; live fanout may be ephemeral. */
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
  deadLetter?: boolean;
  messageTtlMs?: number;
  maxLength?: number;
  maxMessageBytes?: number;
}

export type RabbitEventHandler =
  (
    event:
      EventEnvelope,
  ) => Promise<void>;

export class RabbitMqClient {
  private readonly exchange:
    string;

  private readonly prefetch:
    number;

  private connection:
    Awaited<
      ReturnType<
        typeof amqp.connect
      >
    > | null = null;

  private channel:
    ConfirmChannel | null =
      null;

  constructor(
    private readonly options:
      RabbitMqClientOptions,
  ) {
    this.exchange =
      options.exchange ??
      'blockchain.events';

    this.prefetch =
      options.prefetch ??
      20;
  }

  async connect():
    Promise<void> {
    if (
      this.connection &&
      this.channel
    ) {
      return;
    }

    this.connection =
      await amqp.connect(
        this.options.url,
        { timeout: this.options.connectionTimeoutMs ?? 10_000 },
      );

    this.connection.on(
      'close',
      () => {
        this.connection =
          null;

        this.channel =
          null;
      },
    );

    this.connection.on(
      'error',
      () => {
        /*
         * close event connection
         * state-ті reset етеді.
         */
      },
    );

    this.channel =
      await this.connection
        .createConfirmChannel();

    const connectedChannel = this.channel;
    connectedChannel.on('close', () => {
      if (this.channel === connectedChannel) this.channel = null;
    });
    connectedChannel.on('error', () => undefined);

    await this.channel
      .assertExchange(
        this.exchange,
        'topic',
        {
          durable: true,
        },
      );

    await this.channel
      .prefetch(
        this.prefetch,
      );
  }

  async publish(
    event:
      EventEnvelope,
  ): Promise<void> {
    await this.connect();

    const channel =
      this.requireChannel();

    const body =
      Buffer.from(
        JSON.stringify(
          event,
        ),
        'utf8',
      );

    await new Promise<void>(
      (
        resolve,
        reject,
      ) => {
        channel.publish(
          this.exchange,
          event.type,
          body,
          {
            persistent:
              true,

            contentType:
              'application/json',

            messageId:
              event.id,

            timestamp:
              Date.parse(
                event.occurredAt,
              ),
          },
          (
            error:
              Error | null,
          ) => {
            if (error) {
              reject(
                error,
              );

              return;
            }

            resolve();
          },
        );
      },
    );
  }

  async consume(
    options:
      RabbitConsumerOptions,

    handler:
      RabbitEventHandler,
  ): Promise<void> {
    await this.connect();

    const channel =
      this.requireChannel();

    const deadLetterExchange =
      `${this.exchange}.dlx`;

    const deadLetterQueue =
      options.deadLetterQueue ??
      `${options.queue}.dlq`;

    if (options.deadLetter !== false) {
    await channel
      .assertExchange(
        deadLetterExchange,
        'topic',
        {
          durable: true,
        },
      );

    await channel
      .assertQueue(
        deadLetterQueue,
        {
          durable: true,
        },
      );

    await channel.bindQueue(
      deadLetterQueue,
      deadLetterExchange,
      '#',
    );
    }

    await channel
      .assertQueue(
        options.queue,
        {
          durable: options.durable ?? true,
          exclusive: options.exclusive ?? false,
          autoDelete: options.autoDelete ?? false,

          arguments: {
            ...(options.deadLetter === false ? {} : { 'x-dead-letter-exchange': deadLetterExchange }),
            ...(options.messageTtlMs === undefined ? {} : { 'x-message-ttl': options.messageTtlMs }),
            ...(options.maxLength === undefined ? {} : { 'x-max-length': options.maxLength }),
          },
        },
      );

    for (
      const routingKey of
      options.routingKeys
    ) {
      await channel
        .bindQueue(
          options.queue,
          this.exchange,
          routingKey,
        );
    }

    await channel.consume(
      options.queue,

      async (
        message:
          ConsumeMessage | null,
      ) => {
        if (!message) {
          if (this.channel === channel) this.channel = null;
          return;
        }

        try {
          if (options.maxMessageBytes !== undefined && message.content.length > options.maxMessageBytes) {
            throw new Error('Event message exceeds the subscription limit');
          }
          const parsed: unknown =
            JSON.parse(
              message.content
                .toString(
                  'utf8',
                ),
            );

          if (
            !isEventEnvelope(
              parsed,
            )
          ) {
            throw new Error(
              'Invalid event envelope',
            );
          }

          await handler(
            parsed,
          );

          channel.ack(
            message,
          );
        } catch {
          /*
           * requeue=false:
           * failed message DLQ-ға кетеді.
           */
          try { channel.nack(
            message,
            false,
            false,
          ); } catch { /* The closed channel already returns the unacknowledged delivery. */ }
        }
      },
      {
        noAck:
          false,
      },
    );
  }

  async close():
    Promise<void> {
    if (
      this.channel
    ) {
      await this.channel
        .close()
        .catch(
          () =>
            undefined,
        );
    }

    if (
      this.connection
    ) {
      await this.connection
        .close()
        .catch(
          () =>
            undefined,
        );
    }

    this.channel =
      null;

    this.connection =
      null;
  }

  get isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  private requireChannel():
    ConfirmChannel {
    if (!this.channel) {
      throw new Error(
        'RabbitMQ channel is not connected',
      );
    }

    return this.channel;
  }
}

// RabbitMQ exchange, queue, routing және DLQ механизмін басқарады. Publish кезінде publisher confirm қолданады, consumer тек сәтті өңделген message-ті ack етеді.
