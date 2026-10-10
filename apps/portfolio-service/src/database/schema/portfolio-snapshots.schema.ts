import {
  index,
  numeric,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { portfolios } from './portfolios.schema.js';

export const portfolioSnapshots =
  pgTable(
    'portfolio_snapshots',
    {
      id: uuid('id')
        .defaultRandom()
        .primaryKey(),

      portfolioId: uuid('portfolio_id')
        .notNull()
        .references(
          () => portfolios.id,
          {
            onDelete: 'cascade',
          },
        ),

      totalValueUsd: numeric(
        'total_value_usd',
        {
          precision: 38,
          scale: 2,
        },
      ).notNull(),

      totalValueEth: numeric(
        'total_value_eth',
        {
          precision: 38,
          scale: 18,
        },
      ),

      recordedAt: timestamp(
        'recorded_at',
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),
    },

    (table) => [
      index(
        'portfolio_snapshots_portfolio_time_idx',
      ).on(
        table.portfolioId,
        table.recordedAt,
      ),
    ],
  );
//   Portfolio құнының уақыт бойынша өзгерісін сақтайды. Кейін график пен P&L analytics осыдан жасалады.