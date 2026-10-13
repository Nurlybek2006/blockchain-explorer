import type { users, refreshTokens } from '../../../database/schema/index.js';
import type { AuthenticatedUser } from './authenticated-user.js';

export type AuthUser = typeof users.$inferSelect;
export type RefreshTokenRecord = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

export interface UserProfile extends AuthenticatedUser {
  displayName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface AuthResponse {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export function toUserProfile(user: AuthUser): UserProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}
