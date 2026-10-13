import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthRepository } from './auth.repository.js';
import type { AuthTransaction, NewAuthUser } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import type { AuthUser, NewRefreshToken, RefreshTokenRecord } from './types/auth.types.js';

/** Models commit/rollback and serialized transactions, rather than ignoring transaction failures. */
class MemoryAuthRepository extends AuthRepository {
  users = new Map<string, AuthUser>();
  sessions = new Map<string, RefreshTokenRecord>();
  rollbackCount = 0;
  private transactionTail: Promise<void> = Promise.resolve();

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    return Array.from(this.users.values()).find((user) => user.email === email);
  }

  async findUserById(id: string): Promise<AuthUser | undefined> {
    return this.users.get(id);
  }

  async transaction<T>(action: (transaction: AuthTransaction) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release = (): void => {};
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const originalUsers = structuredClone(this.users);
    const originalSessions = structuredClone(this.sessions);
    const transaction: AuthTransaction = {
      createUser: (input) => this.createUser(input),
      lockUser: async (id) => this.users.get(id),
      lockRefreshToken: async (id) => this.sessions.get(id),
      insertRefreshToken: async (input) => { this.insertSession(input); },
      revokeToken: async (id, at) => {
        const token = this.sessions.get(id);
        if (token && token.revokedAt === null) token.revokedAt = at;
      },
      revokeFamily: async (userId, familyId, at) => {
        for (const token of this.sessions.values()) {
          if (token.userId === userId && token.familyId === familyId && token.revokedAt === null) token.revokedAt = at;
        }
      },
      revokeAll: async (userId, at) => {
        for (const token of this.sessions.values()) {
          if (token.userId === userId && token.revokedAt === null) token.revokedAt = at;
        }
      },
      recordLogin: async (id, at) => {
        const user = this.users.get(id);
        if (user) { user.lastLoginAt = at; user.updatedAt = at; }
        return user;
      },
    };
    try {
      return await action(transaction);
    } catch (error) {
      this.users = originalUsers;
      this.sessions = originalSessions;
      this.rollbackCount += 1;
      throw error;
    } finally {
      release();
    }
  }

  private async createUser(input: NewAuthUser): Promise<AuthUser | undefined> {
    if (await this.findUserByEmail(input.email)) return undefined;
    const now = new Date();
    const user: AuthUser = {
      ...input, id: randomUUID(), role: 'user', isActive: true, emailVerifiedAt: null,
      lastLoginAt: null, createdAt: now, updatedAt: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  private insertSession(input: NewRefreshToken): void {
    const record: RefreshTokenRecord = {
      id: input.id ?? randomUUID(), userId: input.userId, familyId: input.familyId ?? randomUUID(),
      tokenHash: input.tokenHash, userAgent: input.userAgent ?? null, ipAddress: input.ipAddress ?? null,
      expiresAt: input.expiresAt, revokedAt: input.revokedAt ?? null, createdAt: input.createdAt ?? new Date(),
    };
    this.sessions.set(record.id, record);
  }
}

const registration = { email: ' Person@Example.COM ', password: 'Password123!', displayName: ' Person ' };

describe('AuthService session security', () => {
  let repository: MemoryAuthRepository;
  let auth: AuthService;
  let tokens: TokenService;

  beforeEach(() => {
    const config = new ConfigService({
      JWT_ACCESS_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64), BCRYPT_ROUNDS: 10,
    });
    repository = new MemoryAuthRepository();
    tokens = new TokenService(config);
    auth = new AuthService(repository, new PasswordService(config), tokens);
  });

  it('registers normalized users with bcrypt and stores only refresh hashes', async () => {
    const response = await auth.register(registration);
    const storedUser = await repository.findUserById(response.user.id);
    expect(response.user.email).toBe('person@example.com');
    expect(response.user.displayName).toBe('Person');
    expect(response.user).not.toHaveProperty('passwordHash');
    expect(await auth.profile(response.user.id)).not.toHaveProperty('passwordHash');
    expect(storedUser?.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare(registration.password, storedUser?.passwordHash ?? '')).toBe(true);
    const sessions = Array.from(repository.sessions.values());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(tokens.hashRefreshToken(response.refreshToken));
    expect(JSON.stringify(sessions)).not.toContain(response.refreshToken);
    await expect(auth.register(registration)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.users.size).toBe(1);
  });

  it('uses one generic error for missing, incorrect-password, and inactive users', async () => {
    const response = await auth.register(registration);
    const messages: string[] = [];
    for (const credentials of [
      { email: 'missing@example.com', password: registration.password },
      { email: response.user.email, password: 'WrongPassword123!' },
    ]) {
      try { await auth.login(credentials); } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        if (error instanceof Error) messages.push(error.message);
      }
    }
    const user = repository.users.get(response.user.id);
    if (!user) throw new Error('Registered user missing');
    user.isActive = false;
    try { await auth.login({ email: user.email, password: registration.password }); } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      if (error instanceof Error) messages.push(error.message);
    }
    expect(messages).toEqual(['Invalid credentials', 'Invalid credentials', 'Invalid credentials']);
    await expect(auth.authenticatedUser(user.id)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('updates lastLoginAt and rotates into the same family with a new token', async () => {
    const registered = await auth.register(registration);
    const login = await auth.login({ email: registered.user.email, password: registration.password });
    expect(login.user.lastLoginAt).toBeInstanceOf(Date);
    const oldClaims = tokens.verifyRefresh(login.refreshToken);
    const rotated = await auth.refresh(login.refreshToken);
    const newClaims = tokens.verifyRefresh(rotated.refreshToken);
    expect(newClaims.jti).not.toBe(oldClaims.jti);
    expect(newClaims.familyId).toBe(oldClaims.familyId);
    expect(repository.sessions.get(oldClaims.jti)?.revokedAt).toBeInstanceOf(Date);
    expect(repository.sessions.get(newClaims.jti)?.revokedAt).toBeNull();
    expect(rotated.user).not.toHaveProperty('passwordHash');
  });

  it('commits family revocation on reuse, while leaving other sessions active', async () => {
    const registered = await auth.register(registration);
    const separate = await auth.login({ email: registered.user.email, password: registration.password });
    const rotated = await auth.refresh(registered.refreshToken);
    const latestClaims = tokens.verifyRefresh(rotated.refreshToken);
    await expect(auth.refresh(registered.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.rollbackCount).toBe(0);
    expect(repository.sessions.get(latestClaims.jti)?.revokedAt).toBeInstanceOf(Date);
    const separateClaims = tokens.verifyRefresh(separate.refreshToken);
    expect(repository.sessions.get(separateClaims.jti)?.revokedAt).toBeNull();
    await expect(auth.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(separate.refreshToken)).resolves.toHaveProperty('accessToken');
  });

  it('permits only one concurrent rotation and revokes the winner family on replay', async () => {
    const registered = await auth.register(registration);
    const results = await Promise.allSettled([auth.refresh(registered.refreshToken), auth.refresh(registered.refreshToken)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(repository.sessions.size).toBe(2);
    expect(Array.from(repository.sessions.values()).every((session) => session.revokedAt !== null)).toBe(true);
    expect(repository.rollbackCount).toBe(0);
  });

  it('rejects database expiration and mismatched token hashes', async () => {
    const registered = await auth.register(registration);
    const claims = tokens.verifyRefresh(registered.refreshToken);
    const session = repository.sessions.get(claims.jti);
    if (!session) throw new Error('Registered session missing');
    session.expiresAt = new Date(Date.now() - 1000);
    await expect(auth.refresh(registered.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(session.revokedAt).toBeInstanceOf(Date);
    const separate = await auth.login({ email: registered.user.email, password: registration.password });
    const separateSession = repository.sessions.get(tokens.verifyRefresh(separate.refreshToken).jti);
    if (!separateSession) throw new Error('Logged-in session missing');
    separateSession.tokenHash = '0'.repeat(64);
    await expect(auth.refresh(separate.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(separateSession.revokedAt).toBeNull();
  });

  it('logout revokes the family, logout-all revokes every session for only that user', async () => {
    const first = await auth.register(registration);
    const otherUser = await auth.register({ email: 'other@example.com', password: registration.password });
    const second = await auth.login({ email: first.user.email, password: registration.password });
    const rotated = await auth.refresh(first.refreshToken);
    await auth.logout(first.refreshToken);
    await expect(auth.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await auth.logoutAll(first.user.id);
    await expect(auth.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(otherUser.refreshToken)).resolves.toHaveProperty('accessToken');
  });
});
