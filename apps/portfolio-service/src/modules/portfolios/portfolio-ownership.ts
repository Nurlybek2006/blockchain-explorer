import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { portfolios } from '../../database/schema/index.js';

/** Shared predicate for every externally accessible portfolio query or mutation. */
export function activeOwnedPortfolio(userId: string, portfolioId?: string): SQL {
  const predicate = and(
    eq(portfolios.userId, userId),
    isNull(portfolios.archivedAt),
    portfolioId === undefined ? undefined : eq(portfolios.id, portfolioId),
  );
  if (!predicate) {
    throw new Error('Portfolio ownership predicate could not be constructed');
  }
  return predicate;
}
