import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PaginationQueryDto } from '../explorer/dto/pagination-query.dto.js';
import { CreatePortfolioDto } from './dto/create-portfolio.dto.js';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto.js';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const validCreate = {
  name: ' Main ',
  walletAddress: '0x1234567890123456789012345678901234567890',
};

describe('Portfolio public request validation', () => {
  it('trims the name and accepts valid Ethereum wallet addresses', async () => {
    const dto: unknown = await pipe.transform(validCreate, { type: 'body', metatype: CreatePortfolioDto });
    expect(dto).toMatchObject({ name: 'Main', walletAddress: validCreate.walletAddress });
  });

  it('rejects body ownership spoofing rather than forwarding a userId', async () => {
    await expect(pipe.transform({ ...validCreate, userId: 'other-user' }, {
      type: 'body', metatype: CreatePortfolioDto,
    })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects query ownership spoofing', async () => {
    await expect(pipe.transform({ page: '1', limit: '20', userId: 'other-user' }, {
      type: 'query', metatype: PaginationQueryDto,
    })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    { ...validCreate, walletAddress: '0x1234' },
    { ...validCreate, name: '  ' },
    { ...validCreate, name: 'x'.repeat(101) },
    { ...validCreate, chainId: '11155111' },
    { ...validCreate, chainId: -1 },
    { ...validCreate, chainId: 2_147_483_648 },
  ])('rejects invalid create input', async (body) => {
    await expect(pipe.transform(body, {
      type: 'body', metatype: CreatePortfolioDto,
    })).rejects.toMatchObject({ status: 400 });
  });

  it('allows only a name when renaming a portfolio', async () => {
    await expect(pipe.transform({ name: 'New name', walletAddress: validCreate.walletAddress }, {
      type: 'body', metatype: UpdatePortfolioDto,
    })).rejects.toMatchObject({ status: 400 });
    expect(await pipe.transform({ name: ' New name ' }, {
      type: 'body', metatype: UpdatePortfolioDto,
    })).toMatchObject({ name: 'New name' });
  });
});
