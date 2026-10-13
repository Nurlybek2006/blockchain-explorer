import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceRequestLimiter } from './price-request-limiter.js';

describe('price request rate and concurrency limits', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('spaces starts and never exceeds configured simultaneous requests', async () => {
    vi.useFakeTimers();
    const limiter = new PriceRequestLimiter(2, 10);
    const finish: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    let starts = 0;
    const run = () => new Promise<string>((resolve) => {
      active += 1;
      starts += 1;
      peak = Math.max(peak, active);
      finish.push(() => { active -= 1; resolve('done'); });
    });
    const results = [limiter.schedule(run), limiter.schedule(run), limiter.schedule(run)];
    expect(starts).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(starts).toBe(1);
    await vi.advanceTimersByTimeAsync(101);
    expect(starts).toBe(2);
    finish.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toBe(3);
    expect(peak).toBe(2);
    for (const complete of finish) complete();
    expect(await Promise.all(results)).toEqual(['done', 'done', 'done']);
    limiter.close();
  });

  it('rejects queued requests on shutdown and does not start additional work', async () => {
    vi.useFakeTimers();
    const limiter = new PriceRequestLimiter(1, 1);
    void limiter.schedule(() => new Promise<never>(() => {}));
    const queued = limiter.schedule(async () => 'should not start');
    const rejected = expect(queued).rejects.toThrow('closing');
    limiter.close();
    await rejected;
    await expect(limiter.schedule(async () => 'should not start')).rejects.toThrow('closing');
  });
});
