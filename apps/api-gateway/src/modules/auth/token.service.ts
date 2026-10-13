import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import type { AuthenticatedUser } from './types/authenticated-user.js';
import type { NewRefreshToken } from './types/auth.types.js';

interface BaseClaims {
  sub: string;
  iat: number;
  exp: number;
}

export interface AccessClaims extends BaseClaims {
  email: string;
  role: string;
  type: 'access';
}

export interface RefreshClaims extends BaseClaims {
  jti: string;
  familyId: string;
  type: 'refresh';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshRecord: NewRefreshToken;
}

const issuer = 'blockchain-explorer';
const audience = 'blockchain-explorer:api';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasBaseClaims(value: Record<string, unknown>): boolean {
  return typeof value.sub === 'string' && uuidPattern.test(value.sub)
    && typeof value.iat === 'number' && Number.isSafeInteger(value.iat)
    && typeof value.exp === 'number' && Number.isSafeInteger(value.exp)
    && value.iat > 0 && value.exp > value.iat
    && value.iat <= Math.floor(Date.now() / 1000) + 5;
}

function isAccessClaims(value: unknown): value is AccessClaims {
  return isRecord(value) && hasBaseClaims(value) && value.type === 'access'
    && typeof value.email === 'string' && value.email.length > 0 && value.email.length <= 320
    && typeof value.role === 'string' && value.role.length > 0 && value.role.length <= 32;
}

function isRefreshClaims(value: unknown): value is RefreshClaims {
  return isRecord(value) && hasBaseClaims(value) && value.type === 'refresh'
    && typeof value.jti === 'string' && uuidPattern.test(value.jti)
    && typeof value.familyId === 'string' && uuidPattern.test(value.familyId);
}

function readDuration(value: unknown, fallback: string, maximum: number, key: string): number {
  const input = value ?? fallback;
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new Error(`${key} must be an integer number of seconds or a duration such as 15m`);
  }
  const match = /^(\d+)(s|m|h|d)?$/.exec(String(input).trim());
  if (!match || !match[1]) {
    throw new Error(`${key} must be an integer number of seconds or a duration such as 15m`);
  }
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = Number(match[1]) * (multipliers[match[2] ?? 's'] ?? 1);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > maximum) {
    throw new Error(`${key} must be between 1 and ${maximum} seconds`);
  }
  return seconds;
}

@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(config: ConfigService) {
    this.accessSecret = this.readSecret(config, 'JWT_ACCESS_SECRET');
    this.refreshSecret = this.readSecret(config, 'JWT_REFRESH_SECRET');
    if (this.accessSecret === this.refreshSecret) {
      throw new Error('JWT access and refresh secrets must be different');
    }
    this.accessTtl = readDuration(config.get<unknown>('JWT_ACCESS_EXPIRES_IN'), '15m', 3600, 'JWT_ACCESS_EXPIRES_IN');
    this.refreshTtl = readDuration(config.get<unknown>('JWT_REFRESH_EXPIRES_IN'), '30d', 90 * 86400, 'JWT_REFRESH_EXPIRES_IN');
    if (this.refreshTtl <= this.accessTtl) {
      throw new Error('JWT refresh lifespan must exceed the access lifespan');
    }
  }

  issue(user: AuthenticatedUser, familyId: string = randomUUID()): IssuedTokens {
    const issuedAt = Math.floor(Date.now() / 1000);
    const tokenId = randomUUID();
    const accessToken = jwt.sign({
      sub: user.id, email: user.email, role: user.role, type: 'access', iat: issuedAt,
    }, this.accessSecret, { algorithm: 'HS256', expiresIn: this.accessTtl, issuer, audience });
    const refreshToken = jwt.sign({
      sub: user.id, jti: tokenId, familyId, type: 'refresh', iat: issuedAt,
    }, this.refreshSecret, { algorithm: 'HS256', expiresIn: this.refreshTtl, issuer, audience });
    return {
      accessToken, refreshToken, accessTokenExpiresIn: this.accessTtl,
      refreshRecord: {
        id: tokenId,
        userId: user.id,
        familyId,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date((issuedAt + this.refreshTtl) * 1000),
      },
    };
  }

  verifyAccess(rawToken: string): AccessClaims {
    const payload = this.verify(rawToken, this.accessSecret);
    if (!isAccessClaims(payload)) throw new UnauthorizedException('Invalid access token');
    return payload;
  }

  verifyRefresh(rawToken: string): RefreshClaims {
    const payload = this.verify(rawToken, this.refreshSecret);
    if (!isRefreshClaims(payload)) throw new UnauthorizedException('Invalid refresh token');
    return payload;
  }

  hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  matchesRefreshHash(rawToken: string, storedHash: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
    return timingSafeEqual(Buffer.from(this.hashRefreshToken(rawToken), 'hex'), Buffer.from(storedHash, 'hex'));
  }

  private verify(rawToken: string, secret: string): unknown {
    try {
      return jwt.verify(rawToken, secret, { algorithms: ['HS256'], issuer, audience });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private readSecret(config: ConfigService, key: string): string {
    const value = config.getOrThrow<unknown>(key);
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32
      || /^(change[_ -]?me|replace[_ -]?me|your[_ -])/i.test(value)) {
      throw new Error(`${key} must contain a unique random secret of at least 32 bytes`);
    }
    return value;
  }
}
