import { describe, expect, it } from 'vitest';
import { safeReturnPath, validateCredentials } from './validation';
describe('auth validation', () => {
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/login?next=/portfolio', '/register', '/\nportfolio'])('rejects unsafe or looping return target %s', value => { expect(safeReturnPath(value)).toBe('/portfolio'); });
  it('preserves a local paginated return URL', () => { expect(safeReturnPath('/alerts?page=2')).toBe('/alerts?page=2'); });
  it('checks UTF-8 byte length instead of only JavaScript string length', () => { expect(validateCredentials('alice@example.com', 'é'.repeat(37))).toContain('72 UTF-8'); });
  it('rejects mismatched registration passwords', () => { expect(validateCredentials('alice@example.com', 'password1', 'password2')).toBe('Passwords do not match.'); });
  it('accepts a valid email and password', () => { expect(validateCredentials('alice@example.com', 'password1')).toBeNull(); });
});
