interface RequestTask {
  run: () => Promise<string>;
  resolve: (result: string) => void;
  reject: (error: unknown) => void;
}

/** Smooth request starts across the process, including retries after HTTP 429. */
export class PriceRequestLimiter {
  private readonly queue: RequestTask[] = [];
  private active = 0;
  private nextStart = 0;
  private cooldownUntil = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly concurrency: number, private readonly requestsPerSecond: number) {}

  schedule(run: () => Promise<string>): Promise<string> {
    if (this.closed || this.queue.length >= 1_000) {
      return Promise.reject(new Error(this.closed ? 'Price client is closing' : 'Price request queue is full'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ run, resolve, reject });
      this.drain();
    });
  }

  coolDown(milliseconds: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + milliseconds);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    for (const task of this.queue.splice(0)) {
      task.reject(new Error('Price client is closing'));
    }
  }

  private drain(): void {
    if (this.closed || this.queue.length === 0 || this.active >= this.concurrency) return;
    const delay = Math.max(this.nextStart, this.cooldownUntil) - Date.now();
    if (delay > 0) {
      if (!this.timer) {
        this.timer = setTimeout(() => { this.timer = undefined; this.drain(); }, delay);
      }
      return;
    }
    const task = this.queue.shift();
    if (!task) return;
    this.active += 1;
    this.nextStart = Date.now() + Math.ceil(1_000 / this.requestsPerSecond);
    void task.run().then(task.resolve, task.reject).finally(() => {
      this.active -= 1;
      this.drain();
    });
    this.drain();
  }
}
