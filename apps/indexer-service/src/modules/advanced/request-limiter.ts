/** FIFO single-provider limiter with shared cooldown and cancellation, without type casts. */
export class RequestLimiter {
  private readonly queue: Array<() => Promise<void>> = [];
  private readonly waiting = new Set<(error: Error) => void>();
  private running = false;
  private closed = false;
  private nextStart = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly requestsPerSecond: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error('Provider limiter is closed'));
    return new Promise<T>((resolve, reject) => {
      this.waiting.add(reject);
      this.queue.push(async () => {
        this.waiting.delete(reject);
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      });
      void this.drain();
    });
  }

  coolDown(milliseconds: number): void {
    this.nextStart = Math.max(this.nextStart, Date.now() + milliseconds);
  }
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.wake?.();
    for (const reject of this.waiting)
      reject(new Error('Provider limiter is closed'));
    this.waiting.clear();
    this.queue.length = 0;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.closed && this.queue.length) {
        const delay = this.nextStart - Date.now();
        if (delay > 0) {
          await new Promise<void>((resolve) => {
            this.wake = resolve;
            this.timer = setTimeout(resolve, delay);
          });
          this.timer = null;
          this.wake = null;
          continue;
        }
        const task = this.queue.shift();
        this.nextStart = Date.now() + Math.ceil(1000 / this.requestsPerSecond);
        if (task) await task();
      }
    } finally {
      this.running = false;
    }
  }
}
