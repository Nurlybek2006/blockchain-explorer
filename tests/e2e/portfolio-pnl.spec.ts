import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { decodePortfolioPnl, decodePortfolioTrade, decodePortfolioTrades, type PortfolioTradeInput, type PortfolioTradeResponse } from '@blockchain-explorer/contracts';
import { decodeAuth } from '../../apps/web/src/lib/api/auth.api.js';
import { eventually, record, string } from '../helpers/assertions.js';
import { startApplicationStack, type ApplicationStack } from '../helpers/application-stack.js';
import { wallet, hash } from '../helpers/provider-fixtures.js';

describe('persisted transaction cost basis through the public authenticated boundary', () => {
  let stack: ApplicationStack, database: Pool, id: string, access: string, foreignAccess: string;
  let buy: PortfolioTradeResponse, sell: PortfolioTradeResponse;
  const purchase: PortfolioTradeInput = { clientId: 'aa111111-1111-4111-8111-111111111111', assetKey: 'native:eth', symbol: 'ETH', decimals: 18,
    side: 'buy', quantityRaw: '2500000000000000000', unitPriceUsd: '1500', feeUsd: '0',
    occurredAt: '2026-01-01T00:00:00.000Z', transactionHash: hash, activityId: `native:${hash}` };
  async function request(method: string, path: string, status: number, body?: unknown, token: string | null = access): Promise<unknown> {
    const response = await fetch(stack.urls.api + path, { method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    expect(response.status, `${method} ${path}: ${text}`).toBe(status);
    const parsed: unknown = text ? JSON.parse(text) : undefined;
    return parsed;
  }
  async function balance(raw: string) {
    await database.query('UPDATE holdings SET balance_raw=$1, last_updated_block=101 WHERE portfolio_id=$2 AND asset_key=$3', [raw, id, 'native:eth']);
  }
  beforeAll(async () => {
    const environment = inject('environment');
    stack = await startApplicationStack(environment);
    database = new Pool({ connectionString: environment.databaseUrls.portfolio });
    async function account() {
      return decodeAuth(await request('POST', '/auth/register', 201, { email: `pnl-${randomUUID()}@example.test`, password: 'Pnl-integration-password-2026' }, null));
    }
    access = (await account()).accessToken; foreignAccess = (await account()).accessToken;
    id = string(record(await request('POST', '/portfolio', 201, { name: 'P&L integration', walletAddress: wallet })).id);
    await eventually(async () => (await database.query('SELECT 1 FROM holdings WHERE portfolio_id=$1 AND asset_key=$2 AND last_updated_block IS NOT NULL', [id, 'native:eth'])).rows.length === 1, observed => observed);
    // Simulates a canonical balance observation in disposable storage; provider quotes remain real HTTP fixtures ($2000/ETH).
    await balance('2500000000000000000');
  });
  afterAll(async () => { if (stack) await stack.stop(); await database?.end(); });

  it('requires authentication/ownership, rejects forged owner fields and shows unknown basis honestly', async () => {
    await request('GET', `/portfolio/${id}/pnl`, 401, undefined, null);
    await request('GET', `/portfolio/${id}/pnl?userId=11111111-1111-4111-8111-111111111111`, 404, undefined, foreignAccess);
    await request('GET', `/portfolio/${id}/trades`, 404, undefined, foreignAccess);
    await request('POST', `/portfolio/${id}/trades`, 400, { ...purchase, userId: randomUUID() });
    const result = decodePortfolioPnl(await request('GET', `/portfolio/${id}/pnl`, 200));
    expect(result.summary).toMatchObject({ currentValueUsd: '5000', investedUsd: null, totalPnlUsd: null, complete: false });
  });
  it('serializes concurrent idempotent creates and keeps high-precision fields as strings', async () => {
    const results = await Promise.all([request('POST', `/portfolio/${id}/trades`, 201, purchase), request('POST', `/portfolio/${id}/trades`, 201, { ...purchase, clientId: purchase.clientId.toUpperCase() })]);
    buy = decodePortfolioTrade(results[0]);
    expect(decodePortfolioTrade(results[1]).id).toBe(buy.id);
    expect(buy.quantityRaw).toBe('2500000000000000000');
    const journal = decodePortfolioTrades(await request('GET', `/portfolio/${id}/trades`, 200));
    expect(journal.total).toBe(1);
    expect(decodePortfolioPnl(await request('GET', `/portfolio/${id}/pnl`, 200)).summary).toMatchObject({ investedUsd: '3750', currentValueUsd: '5000', totalPnlUsd: '1250', complete: true });
    expect(record(await request('GET', `/portfolio/${id}/analytics`, 200))).toMatchObject({ pnlAvailable: true, pnlReason: null });
  });
  it('rejects conflicting retries, duplicate activity, invalid/future inputs and foreign edits atomically', async () => {
    await request('POST', `/portfolio/${id}/trades`, 409, { ...purchase, unitPriceUsd: '100' });
    await request('POST', `/portfolio/${id}/trades`, 409, { ...purchase, clientId: randomUUID() });
    for (const invalid of [{ quantityRaw: '1e18' }, { unitPriceUsd: null }, { decimals: 6 }, { feeUsd: '-1' }, { occurredAt: '2099-01-01T00:00:00Z' }]) {
      await request('POST', `/portfolio/${id}/trades`, 400, { ...purchase, clientId: randomUUID(), ...invalid });
    }
    await request('PATCH', `/portfolio/${id}/trades/${buy.id}`, 404, purchase, foreignAccess);
    await request('DELETE', `/portfolio/${id}/trades/${buy.id}`, 404, undefined, foreignAccess);
    expect(decodePortfolioTrades(await request('GET', `/portfolio/${id}/trades`, 200)).total).toBe(1);
  });
  it('realizes a partial sale, flags asynchronous balance mismatch, then reconciles current P&L', async () => {
    sell = decodePortfolioTrade(await request('POST', `/portfolio/${id}/trades`, 201, { ...purchase, clientId: randomUUID(), side: 'sell', quantityRaw: '1000000000000000000', unitPriceUsd: '2500', feeUsd: '10', occurredAt: '2026-01-02T00:00:00.000Z', activityId: null }));
    expect(decodePortfolioPnl(await request('GET', `/portfolio/${id}/pnl`, 200)).summary.totalPnlUsd).toBeNull();
    await balance('1500000000000000000');
    const result = decodePortfolioPnl(await request('GET', `/portfolio/${id}/pnl`, 200));
    expect(result.summary).toEqual({ investedUsd: '2250', capitalBasisUsd: '3750', currentValueUsd: '3000', realizedPnlUsd: '990', unrealizedPnlUsd: '750', totalPnlUsd: '1740', roiPercent: '46.4', complete: true });
  });
  it('replays all later sales when a historical price is edited and prevents orphaned disposals', async () => {
    await request('PATCH', `/portfolio/${id}/trades/${buy.id.toUpperCase()}`, 200, { ...purchase, unitPriceUsd: '1600' });
    expect(decodePortfolioPnl(await request('GET', `/portfolio/${id}/pnl`, 200)).summary).toMatchObject({ investedUsd: '2400', realizedPnlUsd: '890', unrealizedPnlUsd: '600', totalPnlUsd: '1490', roiPercent: '37.25' });
    await request('DELETE', `/portfolio/${id}/trades/${buy.id}`, 400);
    expect(decodePortfolioTrades(await request('GET', `/portfolio/${id}/trades`, 200)).total).toBe(2);
    await request('DELETE', `/portfolio/${id}/trades/${sell.id}`, 204);
    await balance('2500000000000000000');
  });
  it('locks the portfolio while replaying concurrent sells so only one oversubscribed disposal commits', async () => {
    const body = { ...purchase, side: 'sell', quantityRaw: '2000000000000000000', unitPriceUsd: '2000', occurredAt: '2026-01-03T00:00:00.000Z', activityId: null };
    const responses = await Promise.all([1, 2].map(() => fetch(`${stack.urls.api}/portfolio/${id}/trades`, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, clientId: randomUUID() }) })));
    expect(responses.map(r => r.status).sort()).toEqual([201, 400]);
    for (const response of responses) await response.body?.cancel();
    expect(decodePortfolioTrades(await request('GET', `/portfolio/${id}/trades`, 200)).total).toBe(2);
  });
  it('persists fees paid in crypto and reconciles their quantity and cost without a second USD charge', async () => {
    await request('POST', `/portfolio/${id}/trades`, 201, { ...purchase, clientId: randomUUID(), side: 'fee',
      quantityRaw: '10000000000000000', unitPriceUsd: null, feeUsd: '0', occurredAt: '2026-01-04T00:00:00.000Z', activityId: null });
    await balance('490000000000000000');
    expect(decodePortfolioPnl(await request('GET', `/portfolio/${id}/pnl`, 200)).summary).toMatchObject({ investedUsd: '784', capitalBasisUsd: '4000', currentValueUsd: '980', realizedPnlUsd: '784', unrealizedPnlUsd: '196', totalPnlUsd: '980', roiPercent: '24.5', complete: true });
  });
  it('keeps archived journals inaccessible through every public operation', async () => {
    await request('DELETE', `/portfolio/${id}`, 204);
    await request('GET', `/portfolio/${id}/pnl`, 404);
    await request('GET', `/portfolio/${id}/trades`, 404);
    await request('POST', `/portfolio/${id}/trades`, 404, purchase);
    await request('PATCH', `/portfolio/${id}/trades/${buy.id}`, 404, purchase);
    await request('DELETE', `/portfolio/${id}/trades/${buy.id}`, 404);
  });
});
