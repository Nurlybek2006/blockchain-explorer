import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AssetPriceResponse } from '@blockchain-explorer/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { alertEvents, alerts } from '../../database/schema/index.js';
import { FinanceDecimal } from '../../common/utils/decimal-math.js';
import { crossingDecision, priceCondition, type AlertSettings } from './alert-evaluation.js';
import { recordCounter } from '@blockchain-explorer/observability';

export type AlertRecord = typeof alerts.$inferSelect;
export type AlertEventRecord = typeof alertEvents.$inferSelect;
export interface NewAlertEvent {
  title: string;
  message: string;
  payload: Record<string, string | number | boolean | null>;
}

export function ownedAlert(userId: string, id?: string) {
  return and(eq(alerts.userId, userId), id === undefined ? undefined : eq(alerts.id, id));
}

export function ownedAlertEvent(userId: string, id?: string) {
  return and(eq(alerts.userId, userId), id === undefined ? undefined : eq(alertEvents.id, id));
}

@Injectable()
export class AlertsRepository {
  constructor(@Inject(DatabaseService) private readonly database: Pick<DatabaseService, 'db'>) {}

  async create(userId: string, settings: AlertSettings): Promise<AlertRecord> {
    const [row] = await this.database.db.insert(alerts).values({ userId, ...settings }).returning();
    if (!row) throw new Error('Alert insert returned no row');
    return row;
  }

  list(userId: string, page: number, limit: number): Promise<{ items: AlertRecord[]; total: number }> {
    return this.database.db.transaction(async (transaction) => {
      const [result] = await transaction.select({ total: count() }).from(alerts).where(ownedAlert(userId));
      const items = await transaction.select().from(alerts).where(ownedAlert(userId))
        .orderBy(desc(alerts.createdAt), asc(alerts.id)).limit(limit).offset((page - 1) * limit);
      return { items, total: result?.total ?? 0 };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async findOwned(userId: string, id: string): Promise<AlertRecord | null> {
    const [row] = await this.database.db.select().from(alerts).where(ownedAlert(userId, id)).limit(1);
    return row ?? null;
  }

  updateOwned(userId: string, id: string, decide: (current: AlertRecord) => AlertSettings): Promise<AlertRecord> {
    return this.database.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(alerts).where(ownedAlert(userId, id)).for('update').limit(1);
      if (!current) throw new NotFoundException('Alert not found');
      const settings = decide(current);
      const thresholdChanged = settings.thresholdUsd === null || current.thresholdUsd === null
        ? settings.thresholdUsd !== current.thresholdUsd
        : !new FinanceDecimal(settings.thresholdUsd).eq(current.thresholdUsd);
      const changed = settings.type !== current.type || settings.enabled !== current.enabled
        || settings.tokenAddress !== current.tokenAddress || settings.walletAddress !== current.walletAddress
        || thresholdChanged;
      const [row] = await transaction.update(alerts).set({
        ...settings, updatedAt: new Date(),
        ...(changed ? { lastConditionMet: null, lastEvaluatedAt: null } : {}),
      }).where(ownedAlert(userId, id)).returning();
      if (!row) throw new NotFoundException('Alert not found');
      return row;
    });
  }

  async deleteOwned(userId: string, id: string): Promise<boolean> {
    const rows = await this.database.db.delete(alerts).where(ownedAlert(userId, id)).returning({ id: alerts.id });
    return rows.length > 0;
  }

  listEvents(userId: string, page: number, limit: number): Promise<{ items: AlertEventRecord[]; total: number }> {
    return this.database.db.transaction(async (transaction) => {
      const [result] = await transaction.select({ total: count() }).from(alertEvents)
        .innerJoin(alerts, eq(alerts.id, alertEvents.alertId)).where(ownedAlertEvent(userId));
      const rows = await transaction.select({ event: alertEvents }).from(alertEvents)
        .innerJoin(alerts, eq(alerts.id, alertEvents.alertId)).where(ownedAlertEvent(userId))
        .orderBy(desc(alertEvents.triggeredAt), asc(alertEvents.id)).limit(limit).offset((page - 1) * limit);
      return { items: rows.map((row) => row.event), total: result?.total ?? 0 };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async markReadOwned(userId: string, id: string): Promise<AlertEventRecord | null> {
    const [row] = await this.database.db.update(alertEvents)
      .set({ readAt: sql`coalesce(${alertEvents.readAt}, now())` })
      .where(and(eq(alertEvents.id, id), inArray(alertEvents.alertId,
        this.database.db.select({ id: alerts.id }).from(alerts).where(ownedAlert(userId)))))
      .returning();
    return row ?? null;
  }

  async transferRules(token: string, from: string, to: string): Promise<AlertRecord[]> {
    return this.database.db.select().from(alerts).where(and(
      eq(alerts.enabled, true), inArray(alerts.type, ['whale', 'wallet_activity']),
      or(isNull(alerts.tokenAddress), sql`lower(${alerts.tokenAddress}) = ${token}`),
      or(isNull(alerts.walletAddress), sql`lower(${alerts.walletAddress}) = ${from}`, sql`lower(${alerts.walletAddress}) = ${to}`),
    )).orderBy(asc(alerts.id));
  }

  /** Lock and revalidate the rule: concurrent edits cannot apply a stale threshold or owner. */
  async insertTransferEvent(id: string, eventKey: string, decide: (current: AlertRecord) => NewAlertEvent | null): Promise<boolean> {
    const result = await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(alerts).where(eq(alerts.id, id)).for('update').limit(1);
      if (!current) return { inserted: false, type: 'other' };
      const event = decide(current);
      if (!event) return { inserted: false, type: 'other' };
      const inserted = await transaction.insert(alertEvents).values({ alertId: id, eventKey, ...event })
        .onConflictDoNothing({ target: [alertEvents.alertId, alertEvents.eventKey] }).returning({ id: alertEvents.id });
      return { inserted: inserted.length > 0, type: current.type };
    });
    if (result.inserted) recordCounter('portfolio_alerts_triggered_total', 1, { alert_type: result.type });
    return result.inserted;
  }

  async evaluatePrice(price: AssetPriceResponse): Promise<void> {
    if (price.priceUsd === null || price.fetchedAt === null || price.availability !== 'available' || price.stale) {
      return;
    }
    const fetchedAt = new Date(price.fetchedAt);
    if (!Number.isFinite(fetchedAt.getTime())) throw new Error('Invalid alert price timestamp');
    const priceUsd = price.priceUsd;
    const triggered = await this.database.db.transaction(async (transaction) => {
      const counts = { price_above: 0, price_below: 0 };
      const rules = await transaction.select().from(alerts).where(and(
        eq(alerts.enabled, true), inArray(alerts.type, ['price_above', 'price_below']),
        price.tokenAddress === null ? isNull(alerts.tokenAddress)
          : sql`lower(${alerts.tokenAddress}) = ${price.tokenAddress.toLowerCase()}`,
      )).orderBy(asc(alerts.id)).for('update');
      for (const rule of rules) {
        if (rule.thresholdUsd === null) continue;
        const condition = priceCondition(rule.type, priceUsd, rule.thresholdUsd);
        const decision = crossingDecision(rule.lastConditionMet, rule.lastEvaluatedAt, fetchedAt, condition);
        if (!decision.update) continue;
        await transaction.update(alerts).set({ lastConditionMet: condition, lastEvaluatedAt: fetchedAt }).where(eq(alerts.id, rule.id));
        if (decision.trigger) {
          const inserted = await transaction.insert(alertEvents).values({
            alertId: rule.id, eventKey: `price:${price.assetKey}:${fetchedAt.toISOString()}`,
            title: rule.type === 'price_above' ? 'Price rose above threshold' : 'Price fell below threshold',
            message: `${price.symbol ?? price.assetKey} price is ${priceUsd} USD; threshold ${rule.thresholdUsd} USD`,
            payload: { assetKey: price.assetKey, tokenAddress: price.tokenAddress, symbol: price.symbol,
              priceUsd, thresholdUsd: rule.thresholdUsd, priceFetchedAt: price.fetchedAt, type: rule.type },
          }).onConflictDoNothing({ target: [alertEvents.alertId, alertEvents.eventKey] }).returning({ id: alertEvents.id });
          if (rule.type === 'price_above' || rule.type === 'price_below') counts[rule.type] += inserted.length;
        }
      }
      return counts;
    });
    for (const type of ['price_above', 'price_below'] as const) {
      if (triggered[type] > 0) recordCounter('portfolio_alerts_triggered_total', triggered[type], { alert_type: type });
    }
  }
}
