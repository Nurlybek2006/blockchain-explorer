import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PortfolioTradeInput } from '@blockchain-explorer/contracts';
import type { TradesRepository, TradeRecord } from './trades.repository.js';
import type { PricesService } from '../prices/prices.service.js';
import { PnlService } from './pnl.service.js';
import { PortfolioTradeDto } from './dto/trade.dto.js';
import { holding, price, state, testDate, testOwner, testPortfolioId } from './analytics.fixtures.js';

const input: PortfolioTradeInput = { clientId: '11111111-1111-4111-8111-111111111111', assetKey: 'native:eth', symbol: 'ETH', decimals: 18,
  side: 'buy', quantityRaw: '2500000000000000000', unitPriceUsd: '2500', feeUsd: '0', occurredAt: '2026-01-01T00:00:00.000Z', transactionHash: null, activityId: null };
const row: TradeRecord = { ...input, id: testPortfolioId, portfolioId: testPortfolioId, sequence: 1n, occurredAt: new Date(input.occurredAt) };
describe('P&L ownership and trade persistence service', () => {
  let repository: Pick<TradesRepository, 'snapshotOwned' | 'writeOwned'>, prices: Pick<PricesService, 'getPrices'>, service: PnlService;
  beforeEach(() => {
    repository = { snapshotOwned: vi.fn<TradesRepository['snapshotOwned']>().mockResolvedValue({ state: state([holding('native:eth', input.quantityRaw)]), entries: [row] }),
      writeOwned: vi.fn<TradesRepository['writeOwned']>().mockResolvedValue(row) };
    prices = { getPrices: vi.fn<PricesService['getPrices']>().mockResolvedValue([price('native:eth', '3200')]) };
    service = new PnlService(repository, prices);
  });
  it('checks ownership before fetching prices or returning journal entries', async () => {
    vi.mocked(repository.snapshotOwned).mockResolvedValue(null);
    await expect(service.summary(testOwner, testPortfolioId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list(testOwner, testPortfolioId)).rejects.toBeInstanceOf(NotFoundException);
    expect(prices.getPrices).not.toHaveBeenCalled();
  });
  it('calculates P&L from one consistent holdings/journal snapshot and fresh typed quotes', async () => {
    expect((await service.summary(testOwner, testPortfolioId)).summary).toMatchObject({ investedUsd: '6250', currentValueUsd: '8000', totalPnlUsd: '1750', roiPercent: '28', complete: true });
    expect(repository.snapshotOwned).toHaveBeenCalledWith(testOwner, testPortfolioId);
    expect(prices.getPrices).toHaveBeenCalledWith(['native:eth']);
  });
  it('returns bounded newest-first pages with exact sequence and decimal fields', async () => {
    const rows = [row, { ...row, id: input.clientId, clientId: testPortfolioId, sequence: 9007199254740993n, unitPriceUsd: '2500.123456789012345678' }];
    vi.mocked(repository.snapshotOwned).mockResolvedValue({ state: state([]), entries: rows });
    const page = await service.list(testOwner, testPortfolioId, 1, 1);
    expect(page).toMatchObject({ total: 2, page: 1, limit: 1, totalPages: 2 });
    expect(page.items[0]).toMatchObject({ sequence: '9007199254740993', unitPriceUsd: '2500.123456789012345678' });
    await expect(service.list(testOwner, testPortfolioId, 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(testOwner, testPortfolioId, 1, 101)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not write malformed or future trades and passes owner/id/edit identity explicitly', async () => {
    await expect(service.save(testOwner, testPortfolioId, { ...input, quantityRaw: '0' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save(testOwner, testPortfolioId, { ...input, occurredAt: '2099-01-01T00:00:00Z' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.writeOwned).not.toHaveBeenCalled();
    await service.save(testOwner, testPortfolioId, input, testPortfolioId);
    expect(repository.writeOwned).toHaveBeenCalledWith(testOwner, testPortfolioId, input, testPortfolioId);
    await service.remove(testOwner, testPortfolioId, testPortfolioId);
    expect(repository.writeOwned).toHaveBeenLastCalledWith(testOwner, testPortfolioId, null, testPortfolioId);
  });
  it('normalizes UUID casing before an idempotent write', async () => {
    const upper = { ...input, clientId: 'AA111111-1111-4111-8111-111111111111' };
    await service.save(testOwner, testPortfolioId, upper);
    expect(repository.writeOwned).toHaveBeenCalledWith(testOwner, testPortfolioId, { ...upper, clientId: upper.clientId.toLowerCase() }, undefined);
  });
  it('validates every field on both create/update payloads, including unknown owner injection', async () => {
    expect(await validate(plainToInstance(PortfolioTradeDto, input), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    for (const change of [{ userId: testOwner }, { quantityRaw: 1 }, { side: 'transfer' }, { unitPriceUsd: null }, { occurredAt: testDate.toString() }]) {
      expect((await validate(plainToInstance(PortfolioTradeDto, { ...input, ...change }), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
    }
  });
});
