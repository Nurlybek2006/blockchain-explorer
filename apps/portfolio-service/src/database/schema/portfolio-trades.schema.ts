import { sql } from 'drizzle-orm';
import { bigserial, check, index, integer, numeric, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { portfolios } from './portfolios.schema.js';

export const portfolioTrades = pgTable('portfolio_trades', {
  id: uuid('id').defaultRandom().primaryKey(),
  portfolioId: uuid('portfolio_id').notNull().references(() => portfolios.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull(),
  sequence: bigserial('sequence', { mode: 'bigint' }).notNull(),
  assetKey: varchar('asset_key', { length: 128 }).notNull(),
  symbol: varchar('symbol', { length: 64 }).notNull(),
  decimals: integer('decimals').notNull(),
  side: varchar('side', { length: 20 }).$type<'buy' | 'sell' | 'transfer_in' | 'transfer_out' | 'fee'>().notNull(),
  quantityRaw: numeric('quantity_raw', { precision: 78, scale: 0 }).notNull(),
  unitPriceUsd: numeric('unit_price_usd', { precision: 78, scale: 18 }),
  feeUsd: numeric('fee_usd', { precision: 78, scale: 18 }).notNull().default('0'),
  occurredAt: timestamp('occurred_at', { withTimezone: true, precision: 3 }).notNull(),
  transactionHash: varchar('transaction_hash', { length: 66 }),
  activityId: varchar('activity_id', { length: 200 }),
}, t => [
  uniqueIndex('portfolio_trades_client_uq').on(t.portfolioId, t.clientId),
  uniqueIndex('portfolio_trades_activity_uq').on(t.portfolioId, t.activityId).where(sql`${t.activityId} IS NOT NULL`),
  index('portfolio_trades_order_idx').on(t.portfolioId, t.occurredAt, t.sequence),
  check('portfolio_trades_values_check', sql`${t.quantityRaw} > 0 AND ${t.quantityRaw} <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND ${t.decimals} BETWEEN 0 AND 255 AND ${t.feeUsd} >= 0 AND (${t.unitPriceUsd} IS NULL OR ${t.unitPriceUsd} >= 0)`),
  check('portfolio_trades_side_check', sql`(${t.side} IN ('buy','sell','transfer_in') AND ${t.unitPriceUsd} IS NOT NULL) OR (${t.side} IN ('transfer_out','fee') AND ${t.unitPriceUsd} IS NULL AND ${t.feeUsd} = 0)`),
]);
