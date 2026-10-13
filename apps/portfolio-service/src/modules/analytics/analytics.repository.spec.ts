import { describe, expect, it } from 'vitest';
import { decodeHistorySnapshotRow } from './analytics.repository.js';

const row = {
  id: '666ab3cd-5a3b-49d6-badc-97783874b700', portfolioId: '48c74c24-c2b8-48b6-a7f8-fdeef6418acb',
  totalValueUsd: '9007199254740993.25', totalValueEth: '1234567890123456789.000000000000000001',
};

describe('raw SQL history column decoding', () => {
  it('maps a PostgreSQL timestamptz string to Date without converting numeric columns to Number', () => {
    const result = decodeHistorySnapshotRow({ ...row, recordedAt: '2026-10-14 08:00:00+00' });
    expect(result.recordedAt.toISOString()).toBe('2026-10-14T08:00:00.000Z');
    expect(result.totalValueUsd).toBe(row.totalValueUsd);
    expect(result.totalValueEth).toBe(row.totalValueEth);
  });

  it('accepts already decoded Date timestamps and nullable ETH values', () => {
    const date = new Date('2026-10-14T08:00:00Z');
    expect(decodeHistorySnapshotRow({ ...row, totalValueEth: null, recordedAt: date })).toEqual({ ...row, totalValueEth: null, recordedAt: date });
  });

  it('rejects invalid timestamps and money columns with a precision-losing numeric representation', () => {
    for (const invalid of [
      { ...row, recordedAt: 'invalid' }, { ...row, recordedAt: 123 },
      { ...row, recordedAt: new Date('invalid') }, { ...row, totalValueUsd: 123, recordedAt: new Date() },
    ]) expect(() => decodeHistorySnapshotRow(invalid)).toThrow();
  });
});
