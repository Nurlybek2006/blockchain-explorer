import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreatePortfolioDto, PortfolioPaginationDto, UpdatePortfolioDto } from './portfolio.dto.js';

const userId = 'f7d40b53-53b2-449b-b16a-673c93dc7d2c';

describe('portfolio DTO validation', () => {
  it('trims names and validates Ethereum wallet format and user UUID', () => {
    const valid = plainToInstance(CreatePortfolioDto, {
      userId, name: ' Main ', walletAddress: ` 0x${'A'.repeat(40)} `,
    });
    expect(validateSync(valid)).toEqual([]);
    expect(valid.name).toBe('Main');
    expect(valid.walletAddress).toBe(`0x${'A'.repeat(40)}`);

    const invalid = plainToInstance(CreatePortfolioDto, { userId: 'other', name: ' ', walletAddress: '0x123' });
    expect(validateSync(invalid).map((error) => error.property).sort())
      .toEqual(['name', 'userId', 'walletAddress']);
  });

  it('parses and bounds pagination without accepting fractional values', () => {
    const valid = plainToInstance(PortfolioPaginationDto, { userId, page: '2', limit: '100' });
    expect(validateSync(valid)).toEqual([]);
    expect(valid.page).toBe(2);
    expect(valid.limit).toBe(100);
    for (const input of [{ page: 0 }, { page: 1.5 }, { page: 1_000_001 }, { limit: 101 }, { limit: 0 }]) {
      expect(validateSync(plainToInstance(PortfolioPaginationDto, { userId, ...input })).length).toBeGreaterThan(0);
    }
  });

  it('rejects blank and oversized rename requests', () => {
    for (const name of [' ', 'a'.repeat(101)]) {
      expect(validateSync(plainToInstance(UpdatePortfolioDto, { name })).length).toBeGreaterThan(0);
    }
  });
});
