import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import type { IssuedTokens, RefreshClaims } from './token.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { AuthenticatedUser } from './types/authenticated-user.js';
import type { AuthResponse, AuthUser, RefreshTokenRecord, UserProfile } from './types/auth.types.js';
import { toUserProfile } from './types/auth.types.js';

type RefreshOutcome = { status: 'ok'; response: AuthResponse } | { status: 'invalid' };

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterDto): Promise<AuthResponse> {
    const passwordHash = await this.passwords.hash(input.password);
    return this.repository.transaction(async (transaction) => {
      const user = await transaction.createUser({
        email: input.email.trim().toLowerCase(), passwordHash, displayName: input.displayName?.trim() ?? null,
      });
      if (!user) throw new ConflictException('Email is already registered');
      const issued = this.tokens.issue(user);
      await transaction.insertRefreshToken(issued.refreshRecord);
      return this.response(user, issued);
    });
  }

  async login(input: LoginDto): Promise<AuthResponse> {
    const candidate = await this.repository.findUserByEmail(input.email.trim().toLowerCase());
    const validPassword = await this.passwords.matches(input.password, candidate?.passwordHash);
    if (!candidate || !candidate.isActive || !validPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.repository.transaction(async (transaction) => {
      const current = await transaction.lockUser(candidate.id);
      if (!current?.isActive || current.passwordHash !== candidate.passwordHash) {
        throw new UnauthorizedException('Invalid credentials');
      }
      const user = await transaction.recordLogin(current.id, new Date());
      if (!user) throw new UnauthorizedException('Invalid credentials');
      const issued = this.tokens.issue(user);
      await transaction.insertRefreshToken(issued.refreshRecord);
      return this.response(user, issued);
    });
  }

  async refresh(rawToken: string): Promise<AuthResponse> {
    const claims = this.tokens.verifyRefresh(rawToken);
    const outcome = await this.repository.transaction<RefreshOutcome>(async (transaction) => {
      // All session operations take this lock first. Logout-all and concurrent rotation cannot interleave.
      const user = await transaction.lockUser(claims.sub);
      const record = await transaction.lockRefreshToken(claims.jti);
      if (!user || !this.matchesSession(record, claims, rawToken)) return { status: 'invalid' };
      const now = new Date();
      if (record.revokedAt !== null || !user.isActive) {
        await transaction.revokeFamily(user.id, record.familyId, now);
        // Return and commit: throwing inside the transaction would roll back reuse revocation.
        return { status: 'invalid' };
      }
      if (record.expiresAt.getTime() <= now.getTime()) {
        await transaction.revokeToken(record.id, now);
        return { status: 'invalid' };
      }
      const issued = this.tokens.issue(user, record.familyId);
      await transaction.revokeToken(record.id, now);
      await transaction.insertRefreshToken(issued.refreshRecord);
      return { status: 'ok', response: this.response(user, issued) };
    });
    if (outcome.status !== 'ok') throw new UnauthorizedException('Invalid refresh token');
    return outcome.response;
  }

  async logout(rawToken: string): Promise<void> {
    const claims = this.tokens.verifyRefresh(rawToken);
    const valid = await this.repository.transaction(async (transaction) => {
      const user = await transaction.lockUser(claims.sub);
      const record = await transaction.lockRefreshToken(claims.jti);
      if (!user || !this.matchesSession(record, claims, rawToken)) return false;
      await transaction.revokeFamily(user.id, record.familyId, new Date());
      return true;
    });
    if (!valid) throw new UnauthorizedException('Invalid refresh token');
  }

  async logoutAll(userId: string): Promise<void> {
    await this.repository.transaction(async (transaction) => {
      const user = await transaction.lockUser(userId);
      if (!user?.isActive) throw new UnauthorizedException('Invalid access token');
      await transaction.revokeAll(user.id, new Date());
    });
  }

  async authenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.activeUser(userId);
    return { id: user.id, email: user.email, role: user.role };
  }

  async profile(userId: string): Promise<UserProfile> {
    return toUserProfile(await this.activeUser(userId));
  }

  private async activeUser(userId: string): Promise<AuthUser> {
    const user = await this.repository.findUserById(userId);
    if (!user?.isActive) throw new UnauthorizedException('Invalid access token');
    return user;
  }

  private matchesSession(record: RefreshTokenRecord | undefined, claims: RefreshClaims, rawToken: string): record is RefreshTokenRecord {
    return record !== undefined && record.userId === claims.sub && record.familyId === claims.familyId
      && this.tokens.matchesRefreshHash(rawToken, record.tokenHash);
  }

  private response(user: AuthUser, issued: IssuedTokens): AuthResponse {
    return {
      user: toUserProfile(user), accessToken: issued.accessToken,
      refreshToken: issued.refreshToken, accessTokenExpiresIn: issued.accessTokenExpiresIn,
    };
  }
}
