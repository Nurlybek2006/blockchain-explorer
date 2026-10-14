export interface DatabasePoolConfiguration {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

/** Shared bounds prevent accidental unbounded pools or infinite connection waits. */
export function databasePoolConfiguration(get: (key: string) => unknown): DatabasePoolConfiguration {
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const raw = get(key);
    if (raw === undefined || raw === null) return fallback;
    if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '') {
      throw new Error(`${key} must be an integer between ${min} and ${max}`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be an integer between ${min} and ${max}`);
    }
    return value;
  };
  return {
    max: integer('DB_POOL_MAX', 10, 1, 100),
    idleTimeoutMillis: integer('DB_IDLE_TIMEOUT_MS', 30_000, 0, 300_000),
    connectionTimeoutMillis: integer('DB_CONNECTION_TIMEOUT_MS', 5_000, 100, 60_000),
  };
}
