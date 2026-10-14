import type { AuthLoginInput, AuthRegisterInput, AuthResponse, AuthUserProfileResponse } from '@blockchain-explorer/contracts/browser';
import { apiRequest, decodeEmpty } from './client';
import { ContractError, readInteger, readNullableString, readNullableTimestamp, readRecord, readString, readTimestamp } from './fields';
export function decodeUser(value: unknown): AuthUserProfileResponse {
  const user = readRecord(value); return { id: readString(user.id), email: readString(user.email), role: readString(user.role),
    displayName: readNullableString(user.displayName), createdAt: readTimestamp(user.createdAt), lastLoginAt: readNullableTimestamp(user.lastLoginAt) };
}
export function decodeAuth(value: unknown): AuthResponse {
  const body = readRecord(value); const accessToken = readString(body.accessToken), refreshToken = readString(body.refreshToken);
  const accessTokenExpiresIn = readInteger(body.accessTokenExpiresIn);
  if (!accessToken || !refreshToken || accessTokenExpiresIn < 1) throw new ContractError('tokens');
  return { user: decodeUser(body.user), accessToken, refreshToken, accessTokenExpiresIn };
}
export const authApi = {
  login: (body: AuthLoginInput) => apiRequest('/auth/login', { method: 'POST', body, decode: decodeAuth }),
  register: (body: AuthRegisterInput) => apiRequest('/auth/register', { method: 'POST', body, decode: decodeAuth }),
  refresh: (refreshToken: string) => apiRequest('/auth/refresh', { method: 'POST', body: { refreshToken }, decode: decodeAuth }),
  logout: (refreshToken: string) => apiRequest('/auth/logout', { method: 'POST', body: { refreshToken }, decode: decodeEmpty }),
  logoutAll: () => apiRequest('/auth/logout-all', { method: 'POST', authenticated: true, decode: decodeEmpty }),
  me: (signal?: AbortSignal) => apiRequest('/users/me', { signal, authenticated: true, decode: decodeUser }),
};
