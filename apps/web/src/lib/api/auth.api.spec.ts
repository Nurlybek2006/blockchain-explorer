import { describe, expect, it } from 'vitest';
import { decodeAuth, decodeUser } from './auth.api';
const user = { id: 'user-id', email: 'alice@example.com', role: 'user', displayName: null, createdAt: '2026-10-14T00:00:00Z', lastLoginAt: null };
describe('identity transport contracts', () => {
  it('allows only public user fields', () => { expect(decodeUser({ ...user, passwordHash: 'private', refreshTokens: ['private'] })).toEqual(user); });
  it('rejects invalid dates', () => { expect(() => decodeUser({ ...user, createdAt: 'invalid' })).toThrow(); });
  it('rejects empty tokens and zero access duration', () => { expect(() => decodeAuth({ user, accessToken: '', refreshToken: 'refresh', accessTokenExpiresIn: 900 })).toThrow(); expect(() => decodeAuth({ user, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresIn: 0 })).toThrow(); });
  it('preserves the actual backend token pair and duration', () => { expect(decodeAuth({ user, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresIn: 900 })).toEqual({ user, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresIn: 900 }); });
});
