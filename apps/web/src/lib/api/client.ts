import { ContractError } from './fields';
import { ApiError } from './api-error';
import { DEFAULT_LOCALE } from '../../i18n/config';
import { getLocalizedApiError, type ApiErrorContext } from '../../i18n/errors';
import type { Locale } from '../../i18n/types';
export { ApiError } from './api-error';
export function mapHttpError(status: number): ApiError {
  const messages: Record<number, string> = {
    400: 'Please check the entered values.', 401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to perform this action.', 404: 'This resource was not found.',
    409: 'This item already exists.', 429: 'Too many requests. Please wait and try again.',
  };
  return new ApiError(status, `http_${status}`, messages[status] ?? 'The service is temporarily unavailable. Please try again.');
}
export type Query = Record<string, string | number | boolean | undefined>;
export function withQuery(path: string, query?: Query): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) parameters.set(key, String(value));
  const text = parameters.toString(); return text ? `${path}${path.includes('?') ? '&' : '?'}${text}` : path;
}
export interface AuthAdapter { getAccessToken(): string | null; getUserId?(): string | null; refresh(): Promise<string | null>; clear(): void; }
let authAdapter: AuthAdapter | null = null;
export function setAuthAdapter(adapter: AuthAdapter): void { authAdapter = adapter; }
export interface RequestOptions<T> {
  decode: (value: unknown) => T; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown;
  query?: Query; signal?: AbortSignal; authenticated?: boolean; timeoutMs?: number;
}
export async function apiRequest<T>(path: string, options: RequestOptions<T>): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError(0, 'invalid_path', 'The request could not be completed.');
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  let token = options.authenticated ? authAdapter?.getAccessToken() : null;
  if (options.authenticated && !token) token = await authAdapter?.refresh();
  if (options.authenticated && !token) throw mapHttpError(401);
  const identity = options.authenticated ? authAdapter?.getUserId?.() : undefined;
  const send = async (access: string | null | undefined): Promise<{ response: Response; body: unknown }> => {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Request timeout')), options.timeoutMs ?? 12000);
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}${withQuery(path, options.query)}`, {
        method: options.method ?? 'GET', headers: {
          Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
        }, body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal, cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) { await response.body?.cancel(); return { response, body: null }; }
      const body: unknown = response.status === 204 ? null : await response.json();
      return { response, body };
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (error instanceof SyntaxError) throw new ApiError(502, 'invalid_json', 'The API returned an unexpected response. Please try again.');
      throw new ApiError(0, controller.signal.aborted ? 'timeout' : 'network', 'Cannot connect to the API. Please try again.');
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  };
  let result = await send(token);
  let response = result.response;
  if (response.status === 401 && options.authenticated && authAdapter) {
    // A different request may already have rotated the access token while this request was in flight.
    token = authAdapter.getAccessToken() !== token ? authAdapter.getAccessToken() : await authAdapter.refresh();
    if (identity !== undefined && authAdapter.getUserId?.() !== identity) throw new ApiError(401, 'account_changed', 'Your account changed. Please retry this action.');
    if (token) { result = await send(token); response = result.response; }
    if (response.status === 401) authAdapter.clear();
  }
  if (!response.ok) throw mapHttpError(response.status);
  try {
    return options.decode(result.body);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, error instanceof ContractError ? 'contract' : 'invalid_json', 'The API returned an unexpected response. Please try again.');
  }
}
export function decodeEmpty(value: unknown): void {
  if (value !== null) throw new ContractError('empty response');
}
export function errorMessage(error: unknown, locale: Locale = DEFAULT_LOCALE, context?: ApiErrorContext): string {
  return getLocalizedApiError(error, locale, context);
}
