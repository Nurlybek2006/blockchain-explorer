import type { PortfolioHistoryResponse } from '@blockchain-explorer/contracts';

function fixed(value: string): bigint {
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer) * 10n ** 18n + BigInt(fraction.padEnd(18, '0').slice(0, 18));
}
export function historyGeometry(points: PortfolioHistoryResponse['points']) {
  if (!points.length) return [];
  const values = points.map(point => fixed(point.valueUsd));
  const minimum = values.reduce((a, b) => a < b ? a : b);
  const maximum = values.reduce((a, b) => a > b ? a : b);
  const span = maximum - minimum;
  const firstTime = Date.parse(points[0].timestamp);
  const lastTime = Date.parse(points[points.length - 1].timestamp);
  return points.map((point, index) => ({
    x: lastTime === firstTime ? 450 : 30 + ((Date.parse(point.timestamp) - firstTime) / (lastTime - firstTime)) * 840,
    // Only a bounded ratio is converted to Number; original USD strings remain intact.
    y: span === 0n ? 115 : 205 - Number((values[index] - minimum) * 100000n / span) / 100000 * 180,
  }));
}
export function historyExtrema(points: PortfolioHistoryResponse['points']) {
  const values = points.map(point => fixed(point.valueUsd));
  return { maxIndex: values.indexOf(values.reduce((a, b) => a > b ? a : b)), minIndex: values.indexOf(values.reduce((a, b) => a < b ? a : b)) };
}
