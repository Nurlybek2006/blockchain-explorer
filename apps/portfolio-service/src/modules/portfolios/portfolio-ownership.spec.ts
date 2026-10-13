import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import * as schema from '../../database/schema/index.js';
import { activeOwnedPortfolio } from './portfolio-ownership.js';

const owner = 'f7d40b53-53b2-449b-b16a-673c93dc7d2c';
const portfolioId = '02d10b90-e68c-4604-b9af-a85c32830679';

describe('activeOwnedPortfolio SQL', () => {
  const database = drizzle.mock({ schema });

  it('scopes lists to the owner and excludes archived portfolios', () => {
    const query = database.select().from(schema.portfolios)
      .where(activeOwnedPortfolio(owner)).toSQL();
    expect(query.sql).toContain('"portfolios"."user_id" = $1');
    expect(query.sql).toContain('"portfolios"."archived_at" is null');
    expect(query.params).toEqual([owner]);
  });

  it('requires owner, active status and ID together for reads and mutations', () => {
    const query = database.update(schema.portfolios).set({ name: 'Renamed' })
      .where(activeOwnedPortfolio(owner, portfolioId)).toSQL();
    expect(query.sql).toContain('"portfolios"."user_id" = $2');
    expect(query.sql).toContain('"portfolios"."archived_at" is null');
    expect(query.sql).toContain('"portfolios"."id" = $3');
    expect(query.params).toEqual(['Renamed', owner, portfolioId]);
  });

  it('checks ownership again in the holdings query through the portfolio join', () => {
    const query = database.select().from(schema.holdings)
      .innerJoin(schema.portfolios, eq(schema.holdings.portfolioId, schema.portfolios.id))
      .where(activeOwnedPortfolio(owner, portfolioId)).toSQL();
    expect(query.sql).toContain('inner join "portfolios"');
    expect(query.sql).toContain('"portfolios"."user_id" = $1');
    expect(query.sql).toContain('"portfolios"."archived_at" is null');
    expect(query.params).toEqual([owner, portfolioId]);
  });
});
