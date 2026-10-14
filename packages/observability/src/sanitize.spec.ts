import { describe, expect, it } from 'vitest';
import { sanitize, sanitizeText } from './sanitize.js';
import { metricAttributes, boundedRoute } from './metrics.js';
import { safeMetricAttributes, safeMetricExemplars } from './metric-privacy.js';

describe('telemetry privacy boundary', () => {
  it('redacts JWT, authorization and bcrypt hashes in free text', () => {
    const result = sanitizeText('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signature $2b$10$' + 'a'.repeat(53));
    expect(result).not.toContain('eyJ'); expect(result).not.toContain('$2b$'); expect(result).toContain('[REDACTED]');
  });
  it('redacts secret keys recursively without leaking headers or bodies', () => {
    expect(sanitize({ Authorization: 'fixture-auth', password: 'fixture-password', refreshToken: 'fixture-refresh', apiKey: 'fixture-key', nested: { cookie: 'fixture-cookie', body: 'fixture-body' } })).toEqual({ Authorization: '[REDACTED]', password: '[REDACTED]', refreshToken: '[REDACTED]', apiKey: '[REDACTED]', nested: { cookie: '[REDACTED]', body: '[REDACTED]' } });
  });
  it('removes connection URL credentials, provider paths and query parameters', () => {
    const result = sanitizeText('postgresql://fixture-user:fixture-password@localhost:5432/database amqp://user:pass@broker/vhost https://rpc.invalid/v3/fixture-key?apikey=fixture-key');
    expect(result).not.toContain('fixture-'); expect(result).not.toContain('user:pass'); expect(result).not.toContain('apikey');
  });
  it('redacts configured secrets even when providers echo them without labels', () => {
    process.env.OBSERVABILITY_TEST_API_KEY = 'fixture-bare-secret';
    try { expect(sanitizeText('provider rejected fixture-bare-secret')).toBe('provider rejected [REDACTED]'); }
    finally { delete process.env.OBSERVABILITY_TEST_API_KEY; }
  });
  it('bounds circular values and large logs', () => {
    const value: Record<string, unknown> = {}; value.self = value;
    expect(sanitize(value)).toEqual({ self: '[CIRCULAR]' });
    expect(sanitizeText('x'.repeat(20_000))).toHaveLength(8_192);
  });
  it('redacts quoted JSON secret keys embedded in provider and parser errors', () => {
    const result = sanitizeText('Invalid response {"api_key":"fixture-json-key","password":"fixture-json-password"} and {\'token\':\'fixture-json-token\'}');
    expect(result).not.toContain('fixture-json-'); expect(result).toContain('[REDACTED]');
  });
});

describe('metric cardinality policy', () => {
  it('rejects user identifiers and collapses dynamic inputs into finite labels', () => {
    expect(metricAttributes({ address: '0x123', hash: '0x456', user_id: 'fixture-user', email: 'fixture@example.invalid', route: '/tx/0x123', job: 'user-controlled', method: 'user-controlled', status: 'user-controlled' })).toEqual({ route: '<unmatched>', job_name: 'other', method: 'other', status: 'other' });
  });
  it('keeps known route templates, RPC methods and isolated queue prefixes bounded', () => {
    expect(boundedRoute('/tx/:hash')).toBe('/tx/:hash');
    expect(metricAttributes({ method: 'debug_traceTransaction', queue: 'random-fixture-prefix-verification', status: 'verified', status_code: 200 })).toEqual({ method: 'debug_traceTransaction', queue: 'contract-verification', status: 'verified', status_code: 200 });
  });
  it('collapses thousands of arbitrary label values to the same record', () => {
    const labels = new Set(Array.from({ length: 2_000 }, (_, index) => JSON.stringify(metricAttributes({ job: `job-${index}`, route: `/tx/${index}`, event_type: `event-${index}` }))));
    expect(labels.size).toBe(1);
  });
  it('filters auto metric headers, URLs, DB credentials and arbitrary semantic method/route values', () => {
    expect(safeMetricAttributes({ 'server.address': 'fixture-host-secret', 'server.port': 1234, 'url.scheme': 'fixture-scheme', 'db.user': 'fixture-db-user', 'db.query.text': 'SELECT fixture-secret', 'http.request.method': 'CUSTOM-user-controlled', 'http.route': '/tx/fixture-hash', 'http.response.status_code': 200, namespace: 'explorer' })).toEqual({ namespace: 'explorer', 'http.request.method': '_OTHER', 'http.route': '<unmatched>', 'http.response.status_code': 200 });
  });
  it('preserves exemplar trace IDs while stripping attributes dropped by views', () => {
    const exemplar = { value: 1, timestamp: [1,2], traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef', filteredAttributes: { authorization: 'fixture-secret', 'server.address': 'untrusted-host' } };
    expect(safeMetricExemplars([exemplar])).toEqual([{ ...exemplar, filteredAttributes: {} }]);
  });
  it('remaps reserved Prometheus job labels while keeping application job names bounded', () => {
    expect(metricAttributes({ job: 'sync-token-holding', instance: 'unsafe-user-instance' })).toEqual({ job_name: 'sync-token-holding' });
    expect(metricAttributes({ job_name: 'user-controlled' })).toEqual({ job_name: 'other' });
  });
});
