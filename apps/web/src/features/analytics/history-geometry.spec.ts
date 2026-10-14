import { describe, expect, it } from 'vitest';
import { historyGeometry } from './history-geometry';

describe('history chart geometry', () => {
  it('preserves sub-dollar differences above Number safe integer range', () => {
    const points = [{ timestamp: '2026-01-01T00:00:00Z', valueUsd: '900719925474099312345.000000000000000001' }, { timestamp: '2026-01-01T01:00:00Z', valueUsd: '900719925474099312345.000000000000000002' }];
    const result = historyGeometry(points); expect(result[0].y).toBe(205); expect(result[1].y).toBe(25); expect(points[0].valueUsd).toBe('900719925474099312345.000000000000000001');
  });
  it('uses timestamps instead of equal spacing between observations', () => {
    const result = historyGeometry([{ timestamp: '2026-01-01T00:00:00Z', valueUsd: '10' }, { timestamp: '2026-01-01T00:15:00Z', valueUsd: '10' }, { timestamp: '2026-01-01T01:00:00Z', valueUsd: '10' }]);
    expect(result[1].x).toBe(240); expect(result.every(point => point.y === 115)).toBe(true);
  });
  it('handles a single zero snapshot and an empty series', () => { expect(historyGeometry([{ timestamp: '2026-01-01T00:00:00Z', valueUsd: '0' }])).toEqual([{ x: 450, y: 115 }]); expect(historyGeometry([])).toEqual([]); });
});
