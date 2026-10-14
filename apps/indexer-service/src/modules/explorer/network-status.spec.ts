import { describe, expect, it } from 'vitest';
import { calculateNetworkLag } from './network-status.js';
describe('network lag', () => {
  it('preserves block precision above the safe integer limit', () => { expect(calculateNetworkLag('900719925474099399999', '900719925474099300000')).toBe('99999'); });
  it('reports zero only when both observed heights match', () => { expect(calculateNetworkLag('10000', '10000')).toBe('0'); });
  it.each([[null, '100'], ['100', null], ['90', '100'], ['1e3', '100']])('keeps unavailable or inconsistent lag null', (latest, indexed) => { expect(calculateNetworkLag(latest, indexed)).toBeNull(); });
});
