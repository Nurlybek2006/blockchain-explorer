import 'reflect-metadata';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AssetPriceResponse } from '@blockchain-explorer/contracts';
import * as schema from '../../database/schema/index.js';
import { AlertsRepository, ownedAlert, ownedAlertEvent } from './alerts.repository.js';

const owner = 'f7d40b53-53b2-449b-b16a-673c93dc7d2c';
const id = '02d10b90-e68c-4604-b9af-a85c32830679';

describe('Alert SQL ownership and replay guards', () => {
  const database = drizzle.mock({ schema });

  it('requires user and alert IDs in mutations', () => {
    const query = database.delete(schema.alerts).where(ownedAlert(owner, id)).toSQL();
    expect(query.params).toEqual([owner, id]);
    expect(query.sql).toContain('"alerts"."user_id"');
    expect(query.sql).toContain('"alerts"."id"');
  });

  it('scopes event visibility through its owning alert', () => {
    const query = database.select().from(schema.alertEvents)
      .innerJoin(schema.alerts, eq(schema.alerts.id, schema.alertEvents.alertId))
      .where(ownedAlertEvent(owner, id)).toSQL();
    expect(query.params).toEqual([owner, id]);
    expect(query.sql).toContain('inner join "alerts"');
    expect(query.sql).toContain('"alerts"."user_id"');
  });

  it('enforces one event key per alert at the database layer', () => {
    const index = getTableConfig(schema.alertEvents).indexes.find((entry) => entry.config.name === 'alert_events_alert_event_key_uq');
    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns).toHaveLength(2);
    const query = database.insert(schema.alertEvents).values({ alertId: id, title: 'Whale', eventKey: 'transfer:1:tx:2' })
      .onConflictDoNothing({ target: [schema.alertEvents.alertId, schema.alertEvents.eventKey] }).toSQL();
    expect(query.sql).toContain('on conflict ("alert_id","event_key") do nothing');
  });

  it('skips stale and unavailable price callbacks before opening a transaction', async () => {
    const repository = new AlertsRepository({ db: database });
    const unavailable: AssetPriceResponse = {
      assetKey: 'native:eth', tokenAddress: null, coinGeckoId: 'ethereum', symbol: 'ETH',
      priceUsd: null, change24hPercent: null, marketCapUsd: null, fetchedAt: null,
      availability: 'unavailable', stale: false,
    };
    await expect(repository.evaluatePrice(unavailable)).resolves.toBeUndefined();
    await expect(repository.evaluatePrice({ ...unavailable, availability: 'available', priceUsd: '3000', fetchedAt: new Date().toISOString(), stale: true })).resolves.toBeUndefined();
  });
});
