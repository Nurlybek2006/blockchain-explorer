import { describe, expect, it } from 'vitest';
import { databasePoolConfiguration } from './database-pool.config.js';

describe('database pool configuration', () => {
  it('preserves bounded defaults', () => {
    expect(databasePoolConfiguration(() => undefined)).toEqual({ max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  });
  it('accepts explicit string settings and zero idle timeout', () => {
    const settings: Record<string, string> = { DB_POOL_MAX: '20', DB_IDLE_TIMEOUT_MS: '0', DB_CONNECTION_TIMEOUT_MS: '1000' };
    expect(databasePoolConfiguration((key) => settings[key])).toEqual({ max: 20, idleTimeoutMillis: 0, connectionTimeoutMillis: 1000 });
  });
  it.each(['', 'NaN', 'Infinity', '1.5', '0', '101', '-1'])('rejects invalid maximum %j without revealing connection secrets', (value) => {
    expect(() => databasePoolConfiguration((key) => key === 'DB_POOL_MAX' ? value : undefined)).toThrow('DB_POOL_MAX must be an integer');
  });
  it('rejects an infinite connection wait', () => {
    expect(() => databasePoolConfiguration((key) => key === 'DB_CONNECTION_TIMEOUT_MS' ? 0 : undefined)).toThrow('DB_CONNECTION_TIMEOUT_MS');
  });
});
