import { ApiError } from '../lib/api/api-error';
import { createTranslator } from './translator';
import type { Locale, TranslationKey } from './types';

export type ApiErrorContext = 'login' | 'register' | 'watchlist-item' | 'trade';
type ErrorTranslationKey = Extract<TranslationKey, `errors.${string}` | 'watchlists.duplicate' | 'pnl.validation.history' | 'pnl.validation.duplicate'>;
export function getApiErrorKey(error: unknown, context?: ApiErrorContext): ErrorTranslationKey {
  if (!(error instanceof ApiError)) return 'errors.unknown';
  if (error.code === 'account_changed') return 'errors.accountChanged';
  if (error.code === 'timeout') return 'errors.timeout';
  if (error.code === 'network') return 'errors.network';
  if (error.code === 'contract' || error.code === 'invalid_json') return 'errors.invalidResponse';
  if (context === 'login' && error.status === 401) return 'errors.invalidCredentials';
  if (context === 'register' && error.status === 409) return 'errors.emailExists';
  if (context === 'watchlist-item' && error.status === 409) return 'watchlists.duplicate';
  if (context === 'trade' && error.status === 400) return 'pnl.validation.history';
  if (context === 'trade' && error.status === 409) return 'pnl.validation.duplicate';
  const keys: Readonly<Record<number, ErrorTranslationKey>> = {
    400: 'errors.invalidInput', 401: 'errors.sessionExpired', 403: 'errors.accessDenied',
    404: 'errors.notFound', 409: 'errors.conflict', 413: 'errors.bodyTooLarge',
    415: 'errors.unsupportedBody', 422: 'errors.invalidInput', 429: 'errors.tooManyRequests',
    500: 'errors.unknown', 502: 'errors.unavailable', 503: 'errors.unavailable', 504: 'errors.timeout',
  };
  return keys[error.status] ?? 'errors.unknown';
}
export function getLocalizedApiError(error: unknown, locale: Locale, context?: ApiErrorContext): string {
  const key = getApiErrorKey(error, context);
  // Error keys are fixed templates without user/provider-controlled interpolation.
  return createTranslator(locale)(key);
}
