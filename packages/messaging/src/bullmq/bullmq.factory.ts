import {
  Queue,
  Worker,
  type JobsOptions,
  type Processor,
} from 'bullmq';
import { injectTraceContext, recordCounter, recordGauge, recordHistogram, SpanKind, withSpan, withTraceContext } from '@blockchain-explorer/observability';
import { parseJobTraceContext, queueMetricName } from '../telemetry.js';

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
    const queue = new Queue<TData, TResult, TName>(
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
    const metricQueue = queueMetricName(name);
    const add = queue.add.bind(queue);
    queue.add = (jobName, data, options) => withSpan('bullmq.enqueue', {
      'messaging.system': 'redis', 'messaging.destination.name': metricQueue, 'messaging.operation.name': 'publish',
    }, () => add(jobName, data, {
      ...options,
      telemetry: options?.telemetry?.omitContext ? options.telemetry : {
        ...options?.telemetry,
        metadata: JSON.stringify(injectTraceContext()),
      },
    }), { kind: SpanKind.PRODUCER });

    // Poll once per interval in the background, never during a metrics scrape.
    let closed = false;
    let collecting = false;
    const collect = async () => {
      if (closed || collecting) return;
      collecting = true;
      try {
        const counts = await queue.getJobCounts('active', 'waiting');
        if (!closed) {
          recordGauge('bullmq_jobs_active', counts.active ?? 0, { queue: metricQueue });
          recordGauge('bullmq_jobs_waiting', counts.waiting ?? 0, { queue: metricQueue });
        }
      } catch {
        if (!closed) {
          recordGauge('bullmq_jobs_active', null, { queue: metricQueue });
          recordGauge('bullmq_jobs_waiting', null, { queue: metricQueue });
        }
      } finally { collecting = false; }
    };
    const interval = setInterval(() => { void collect(); }, 15_000);
    interval.unref();
    const close = queue.close.bind(queue);
    queue.close = async () => {
      closed = true; clearInterval(interval);
      recordGauge('bullmq_jobs_active', null, { queue: metricQueue });
      recordGauge('bullmq_jobs_waiting', null, { queue: metricQueue });
      await close();
    };
    void collect();
    return queue;
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
    const metricQueue = queueMetricName(name);
    const instrumentedProcessor: Processor<TData, TResult, TName> = (job, token) =>
      withTraceContext(parseJobTraceContext(job.opts.telemetry?.metadata), () =>
        withSpan('bullmq.job', {
          'messaging.system': 'redis', 'messaging.destination.name': metricQueue,
          'messaging.operation.name': 'process', 'retry.attempt': job.attemptsMade,
        }, async () => {
          const started = performance.now();
          try { return await processor(job, token); }
          finally { recordHistogram('bullmq_job_duration_seconds', (performance.now() - started) / 1_000, { queue: metricQueue, job_name: job.name }); }
        }, { kind: SpanKind.CONSUMER }));
    const worker = new Worker<
      TData,
      TResult,
      TName
    >(
      name,
      instrumentedProcessor,
      {
        connection:
          this.connection,

        concurrency,
      },
    );
    worker.on('completed', (job) => { recordCounter('bullmq_jobs_completed_total', 1, { queue: metricQueue, job_name: job.name }); });
    worker.on('failed', (job) => { recordCounter('bullmq_jobs_failed_total', 1, { queue: metricQueue, job_name: job?.name ?? 'other' }); });
    return worker;
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
