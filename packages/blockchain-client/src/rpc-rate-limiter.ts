interface RateLimiterOptions {
  maxConcurrentRequests: number;

  requestsPerSecond: number;
}

interface QueueItem {
  execute: () => Promise<unknown>;

  resolve: (
    value: unknown,
  ) => void;

  reject: (
    reason?: unknown,
  ) => void;
}

export class RpcRateLimiter {
  private readonly queue:
    QueueItem[] = [];

  private readonly requestTimestamps:
    number[] = [];

  private activeRequests = 0;

  private cooldownUntil = 0;

  private timer:
    ReturnType<
      typeof setTimeout
    > | null = null;

  constructor(
    private readonly options:
      RateLimiterOptions,
  ) {
    if (
      options
        .maxConcurrentRequests <
      1
    ) {
      throw new Error(
        'maxConcurrentRequests must be >= 1',
      );
    }

    if (
      options.requestsPerSecond <
      1
    ) {
      throw new Error(
        'requestsPerSecond must be >= 1',
      );
    }
  }

  schedule<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>(
      (
        resolve,
        reject,
      ) => {
        this.queue.push({
          execute: task,

          resolve: (
            value,
          ) => {
            resolve(
              value as T,
            );
          },

          reject,
        });

        this.drain();
      },
    );
  }

  coolDown(
    milliseconds: number,
  ): void {
    if (
      milliseconds <= 0
    ) {
      return;
    }

    const until =
      Date.now() +
      milliseconds;

    this.cooldownUntil =
      Math.max(
        this.cooldownUntil,
        until,
      );

    this.scheduleDrain(
      milliseconds,
    );
  }

  private drain(): void {
    this.clearExpiredTimestamps();

    if (
      this.queue.length === 0
    ) {
      return;
    }

    const now =
      Date.now();

    if (
      now <
      this.cooldownUntil
    ) {
      this.scheduleDrain(
        this.cooldownUntil -
          now,
      );

      return;
    }

    while (
      this.queue.length >
        0 &&
      this.activeRequests <
        this.options
          .maxConcurrentRequests
    ) {
      this.clearExpiredTimestamps();

      if (
        this.requestTimestamps
          .length >=
        this.options
          .requestsPerSecond
      ) {
        const oldest =
          this
            .requestTimestamps[0];

        const waitTime =
          Math.max(
            1,
            oldest +
              1000 -
              Date.now(),
          );

        this.scheduleDrain(
          waitTime,
        );

        return;
      }

      const item =
        this.queue.shift();

      if (!item) {
        return;
      }

      this.activeRequests +=
        1;

      this.requestTimestamps.push(
        Date.now(),
      );

      void item
        .execute()
        .then(
          (
            result,
          ) => {
            item.resolve(
              result,
            );
          },
        )
        .catch(
          (
            error,
          ) => {
            item.reject(
              error,
            );
          },
        )
        .finally(
          () => {
            this.activeRequests -=
              1;

            this.drain();
          },
        );
    }
  }

  private clearExpiredTimestamps():
    void {
    const threshold =
      Date.now() - 1000;

    while (
      this.requestTimestamps
        .length >
        0 &&
      this.requestTimestamps[0] <=
        threshold
    ) {
      this.requestTimestamps.shift();
    }
  }

  private scheduleDrain(
    milliseconds: number,
  ): void {
    if (
      this.timer !== null
    ) {
      return;
    }

    this.timer =
      setTimeout(
        () => {
          this.timer =
            null;

          this.drain();
        },
        Math.max(
          milliseconds,
          1,
        ),
      );
  }
}
// Барлық RPC request-терді бір queue арқылы өткізіп, секундтық лимит пен параллель request санын бақылайды. 429 алынса бүкіл queue уақытша тоқтай алады.