import {
  Queue,
  Worker,
  type JobsOptions,
  type Processor,
} from 'bullmq';

export interface BullMqFactoryOptions {
  redisUrl: string;
}

export class BullMqFactory {
  private readonly connection;

  constructor(
    options:
      BullMqFactoryOptions,
  ) {
    this.connection =
      parseRedisUrl(
        options.redisUrl,
      );
  }

  createQueue<
    TData,
    TResult = unknown,
    TName extends string = string,
  >(
    name: string,

    defaultJobOptions:
      JobsOptions = {},
  ): Queue<TData, TResult, TName> {
    return new Queue<TData, TResult, TName>(
      name,
      {
        connection:
          this.connection,

        defaultJobOptions: {
          attempts:
            5,

          backoff: {
            type:
              'exponential',

            delay:
              1000,
          },

          removeOnComplete: {
            age:
              24 * 60 * 60,

            count:
              10_000,
          },

          removeOnFail: {
            age:
              7 *
              24 *
              60 *
              60,

            count:
              50_000,
          },

          ...defaultJobOptions,
        },
      },
    );
  }

  createWorker<
    TData,
    TResult = unknown,
    TName extends string = string,
  >(
    name: string,

    processor:
      Processor<
        TData,
        TResult,
        TName
      >,

    concurrency = 5,
  ): Worker<
    TData,
    TResult,
    TName
  > {
    return new Worker<
      TData,
      TResult,
      TName
    >(
      name,
      processor,
      {
        connection:
          this.connection,

        concurrency,
      },
    );
  }
}

function parseRedisUrl(
  redisUrl: string,
) {
  const url =
    new URL(
      redisUrl,
    );

  if (
    url.protocol !==
      'redis:' &&
    url.protocol !==
      'rediss:'
  ) {
    throw new Error(
      'Invalid Redis URL',
    );
  }

  const databaseRaw =
    url.pathname
      .replace(
        '/',
        '',
      );

  return {
    host:
      url.hostname,

    port:
      Number(
        url.port ||
          6379,
      ),

    username:
      url.username
        ? decodeURIComponent(
            url.username,
          )
        : undefined,

    password:
      url.password
        ? decodeURIComponent(
            url.password,
          )
        : undefined,

    db:
      databaseRaw
        ? Number(
            databaseRaw,
          )
        : 0,

    ...(url.protocol ===
    'rediss:'
      ? {
          tls: {},
        }
      : {}),
  };
}
// Redis-backed BullMQ Queue мен Worker жасауды стандарттайды. Retry, exponential backoff және job cleanup автоматты беріледі.
