/** Serialized public identity API contracts; no database or JWT implementation imports. */
export interface AuthUserProfileResponse {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthResponse {
  user: AuthUserProfileResponse;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export interface AuthLoginInput {
  email: string;
  password: string;
}

export interface AuthRegisterInput extends AuthLoginInput {
  displayName?: string;
}

export interface AuthRefreshInput {
  refreshToken: string;
}
