import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { RegisterDto } from './dto/register.dto.js';
import { TokenService } from './token.service.js';

const accessSecret = 'a'.repeat(64);
const refreshSecret = 'b'.repeat(64);
const user = { id: randomUUID(), email: 'user@example.com', role: 'user' };
const config = () => new ConfigService({ JWT_ACCESS_SECRET: accessSecret, JWT_REFRESH_SECRET: refreshSecret });
const options = { issuer: 'blockchain-explorer', audience: 'blockchain-explorer:api', expiresIn: 900 };

describe('TokenService verification', () => {
  it('issues separate typed tokens with bounded TTLs and unpredictable session IDs', () => {
    const service = new TokenService(config());
    const first = service.issue(user);
    const second = service.issue(user);
    const access = service.verifyAccess(first.accessToken);
    const refresh = service.verifyRefresh(first.refreshToken);
    expect(access.exp - access.iat).toBe(900);
    expect(refresh.exp - refresh.iat).toBe(30 * 86400);
    expect(first.accessTokenExpiresIn).toBe(900);
    expect(service.verifyRefresh(second.refreshToken).jti).not.toBe(refresh.jti);
    expect(service.verifyRefresh(second.refreshToken).familyId).not.toBe(refresh.familyId);
    expect(first.refreshRecord.expiresAt.getTime()).toBe(refresh.exp * 1000);
    expect(() => service.verifyAccess(first.refreshToken)).toThrow(UnauthorizedException);
    expect(() => service.verifyRefresh(first.accessToken)).toThrow(UnauthorizedException);
    expect(service.matchesRefreshHash(first.refreshToken, first.refreshRecord.tokenHash)).toBe(true);
    expect(service.matchesRefreshHash(second.refreshToken, first.refreshRecord.tokenHash)).toBe(false);
  });

  it('rejects wrong algorithms, expired tokens, wrong token type, issuer, and malformed claims', () => {
    const service = new TokenService(config());
    const valid = { sub: user.id, email: user.email, role: user.role, type: 'access' };
    const invalid = [
      jwt.sign(valid, accessSecret, { ...options, algorithm: 'HS384' }),
      jwt.sign(valid, accessSecret, { ...options, expiresIn: -1 }),
      jwt.sign({ ...valid, type: 'refresh' }, accessSecret, options),
      jwt.sign(valid, accessSecret, { ...options, issuer: 'another-issuer' }),
      jwt.sign({ ...valid, sub: 'not-a-uuid' }, accessSecret, options),
      jwt.sign({ ...valid, role: 1 }, accessSecret, options),
      jwt.sign(valid, accessSecret, { issuer: options.issuer, audience: options.audience }),
      jwt.sign({ ...valid, iat: Math.floor(Date.now() / 1000) + 300 }, accessSecret, options),
    ];
    for (const token of invalid) expect(() => service.verifyAccess(token)).toThrow(UnauthorizedException);
    const malformedRefresh = jwt.sign({ sub: user.id, type: 'refresh', jti: 'bad', familyId: randomUUID() }, refreshSecret, options);
    expect(() => service.verifyRefresh(malformedRefresh)).toThrow(UnauthorizedException);
  });

  it('rejects unsafe configuration and accepts numeric-second duration settings', () => {
    const bad = [
      { JWT_ACCESS_SECRET: 'short', JWT_REFRESH_SECRET: refreshSecret },
      { JWT_ACCESS_SECRET: accessSecret, JWT_REFRESH_SECRET: accessSecret },
      { JWT_ACCESS_SECRET: `change_me${'a'.repeat(64)}`, JWT_REFRESH_SECRET: refreshSecret },
      { JWT_ACCESS_SECRET: accessSecret, JWT_REFRESH_SECRET: refreshSecret, JWT_ACCESS_EXPIRES_IN: '2h' },
      { JWT_ACCESS_SECRET: accessSecret, JWT_REFRESH_SECRET: refreshSecret, JWT_REFRESH_EXPIRES_IN: '10m' },
    ];
    for (const settings of bad) expect(() => new TokenService(new ConfigService(settings))).toThrow();
    const service = new TokenService(new ConfigService({
      JWT_ACCESS_SECRET: accessSecret, JWT_REFRESH_SECRET: refreshSecret,
      JWT_ACCESS_EXPIRES_IN: 300, JWT_REFRESH_EXPIRES_IN: '1d',
    }));
    expect(service.issue(user).accessTokenExpiresIn).toBe(300);
  });
});

describe('RegisterDto validation', () => {
  it('normalizes identity fields while preserving password whitespace', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: ' USER@EXAMPLE.COM ', password: ' Password123! ', displayName: ' User ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.email).toBe('user@example.com');
    expect(dto.displayName).toBe('User');
    expect(dto.password).toBe(' Password123! ');
  });

  it('rejects passwords that bcrypt would truncate, including UTF-8 multibyte strings', async () => {
    for (const password of ['x'.repeat(73), 'Ж'.repeat(37), 'short']) {
      const errors = await validate(plainToInstance(RegisterDto, { email: user.email, password }));
      expect(errors.some((error) => error.property === 'password')).toBe(true);
    }
    expect(await validate(plainToInstance(RegisterDto, { email: user.email, password: 'Ж'.repeat(36) }))).toHaveLength(0);
  });
});
