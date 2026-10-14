import { describe, expect, it } from 'vitest';
import nextConfig, { frontendSecurityHeaders } from '../../../next.config';

describe('frontend security policy', () => {
  it('preserves static hydration and restricts production connections to configured origins', () => {
    const headers = new Map(frontendSecurityHeaders({
      NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'https://api.example.test', NEXT_PUBLIC_WS_URL: 'wss://api.example.test/realtime',
    }).map((header) => [header.key, header.value]));
    const csp = headers.get('Content-Security-Policy');
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("connect-src 'self' https://api.example.test wss://api.example.test");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('*');
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.has('Strict-Transport-Security')).toBe(false);
  });

  it('permits dev tooling and emits HSTS only for an explicit production TLS deployment', () => {
    expect(frontendSecurityHeaders({ NODE_ENV: 'development', SECURITY_HSTS_ENABLED: 'true' })
      .find((header) => header.key === 'Content-Security-Policy')?.value).toContain('unsafe-eval');
    expect(frontendSecurityHeaders({ NODE_ENV: 'development', SECURITY_HSTS_ENABLED: 'true' })
      .some((header) => header.key === 'Strict-Transport-Security')).toBe(false);
    expect(frontendSecurityHeaders({ NODE_ENV: 'production', SECURITY_HSTS_ENABLED: 'true' })
      .find((header) => header.key === 'Strict-Transport-Security')?.value).toBe('max-age=31536000');
  });

  it('rejects credential-bearing and executable public endpoints', () => {
    for (const value of ['javascript:alert(1)', 'https://user:secret@example.test', '//example.test']) {
      expect(() => frontendSecurityHeaders({ NEXT_PUBLIC_API_URL: value })).toThrow();
    }
    expect(() => frontendSecurityHeaders({ NEXT_PUBLIC_WS_URL: 'https://example.test' })).toThrow();
  });

  it('keeps standalone monorepo output and disables the framework identification header', async () => {
    expect(nextConfig.output).toBe('standalone');
    expect(nextConfig.outputFileTracingRoot?.replaceAll('\\', '/')).toMatch(/\/blockchain-explorer$/);
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(await nextConfig.headers?.()).toHaveLength(1);
  });
});
