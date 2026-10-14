import { setTimeout } from 'node:timers/promises';

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}

export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string');
  return value;
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array');
  return value;
}

export async function eventually<T>(work: () => Promise<T>, accept: (result: T) => boolean, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await work();
    if (accept(result)) return result;
    await setTimeout(100);
  }
  throw new Error(`Condition was not satisfied within ${timeout} ms`);
}
