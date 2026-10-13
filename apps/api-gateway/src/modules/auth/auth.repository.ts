import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { refreshTokens, users } from '../../database/schema/index.js';
import type { AuthUser, NewRefreshToken, RefreshTokenRecord } from './types/auth.types.js';

export interface NewAuthUser {
  email: string;
  passwordHash: string;
  displayName: string | null;
}

/** A transaction owns the user lock before changing any of that user's sessions. */
export interface AuthTransaction {
  createUser(input: NewAuthUser): Promise<AuthUser | undefined>;
  lockUser(userId: string): Promise<AuthUser | undefined>;
  lockRefreshToken(tokenId: string): Promise<RefreshTokenRecord | undefined>;
  insertRefreshToken(input: NewRefreshToken): Promise<void>;
  revokeToken(tokenId: string, at: Date): Promise<void>;
  revokeFamily(userId: string, familyId: string, at: Date): Promise<void>;
  revokeAll(userId: string, at: Date): Promise<void>;
  recordLogin(userId: string, at: Date): Promise<AuthUser | undefined>;
}

export abstract class AuthRepository {
  abstract findUserByEmail(email: string): Promise<AuthUser | undefined>;
  abstract findUserById(id: string): Promise<AuthUser | undefined>;
  abstract transaction<T>(action: (transaction: AuthTransaction) => Promise<T>): Promise<T>;
}

type AuthDatabaseTransaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

class DrizzleAuthTransaction implements AuthTransaction {
  constructor(private readonly db: AuthDatabaseTransaction) {}

  async createUser(input: NewAuthUser): Promise<AuthUser | undefined> {
    const [user] = await this.db.insert(users).values(input)
      .onConflictDoNothing({ target: users.email }).returning();
    return user;
  }

  async lockUser(userId: string): Promise<AuthUser | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).for('update');
    return user;
  }

  async lockRefreshToken(tokenId: string): Promise<RefreshTokenRecord | undefined> {
    const [token] = await this.db.select().from(refreshTokens)
      .where(eq(refreshTokens.id, tokenId)).for('update');
    return token;
  }

  async insertRefreshToken(input: NewRefreshToken): Promise<void> {
    await this.db.insert(refreshTokens).values(input);
  }

  async revokeToken(tokenId: string, at: Date): Promise<void> {
    await this.db.update(refreshTokens).set({ revokedAt: at })
      .where(and(eq(refreshTokens.id, tokenId), isNull(refreshTokens.revokedAt)));
  }

  async revokeFamily(userId: string, familyId: string, at: Date): Promise<void> {
    await this.db.update(refreshTokens).set({ revokedAt: at }).where(and(
      eq(refreshTokens.userId, userId), eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt),
    ));
  }

  async revokeAll(userId: string, at: Date): Promise<void> {
    await this.db.update(refreshTokens).set({ revokedAt: at })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async recordLogin(userId: string, at: Date): Promise<AuthUser | undefined> {
    const [user] = await this.db.update(users).set({ lastLoginAt: at, updatedAt: at })
      .where(eq(users.id, userId)).returning();
    return user;
  }
}

@Injectable()
export class DrizzleAuthRepository extends AuthRepository {
  constructor(private readonly database: DatabaseService) { super(); }

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    const [user] = await this.database.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async findUserById(id: string): Promise<AuthUser | undefined> {
    const [user] = await this.database.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  transaction<T>(action: (transaction: AuthTransaction) => Promise<T>): Promise<T> {
    return this.database.db.transaction((db) => action(new DrizzleAuthTransaction(db)));
  }
}
