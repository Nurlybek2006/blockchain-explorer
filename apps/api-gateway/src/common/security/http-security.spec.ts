import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Body, Controller, Get, Post, UseGuards, ValidationPipe, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RedisCacheClient } from '@blockchain-explorer/messaging';
import { StructuredLogger, requestTelemetry } from '@blockchain-explorer/observability';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { AuthService } from '../../modules/auth/auth.service.js';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard.js';
import { TokenService } from '../../modules/auth/token.service.js';
import { LoginDto } from '../../modules/auth/dto/login.dto.js';
import { configureHttpSecurity } from './http-security.js';
import { SecurityRateLimitService } from './security-rate-limit.service.js';
import { readHttpSecurityConfig } from './http-security.config.js';
import { publicError } from './api-exception.filter.js';

@Controller()
class BoundaryController {
  @Post('auth/login') login(@Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) _input: LoginDto) { return { accepted: true }; }
  @Post('auth/register') register() { return { accepted: true }; }
  @Get('search') search() { return { available: true }; }
  @Get('stats') stats() { return { available: true }; }
  @Get('tx/:hash/traces') traces() { return { available: true }; }
  @Get('secure') @UseGuards(JwtAuthGuard) secure() { return { authenticated: true }; }
  @Get('failure') failure() { throw new InternalServerErrorException('postgres://admin:password@private:5432/identity_db SELECT secret'); }
  @Get('unexpected') unexpected() { throw new Error('private connection password and stack details'); }
}

const user = { id: randomUUID(), email: 'user@example.test', role: 'user' };

describe('Gateway actual HTTP security boundary', () => {
  let app: NestExpressApplication;
  let base: string;
  let limiter: SecurityRateLimitService;
  let tokens: TokenService;
  let consume: MockInstance<RedisCacheClient['consumeFixedWindow']>;
  let ping: MockInstance<RedisCacheClient['ping']>;
  const authenticatedUser = vi.fn<AuthService['authenticatedUser']>().mockResolvedValue(user);

  beforeEach(async () => {
    const config = new ConfigService({
      NODE_ENV: 'test', WEB_ORIGIN: 'http://localhost:3003', REDIS_URL: 'redis://127.0.0.1:1',
      RATE_LIMIT_AUTH_MAX: '2', RATE_LIMIT_SEARCH_MAX: '3', RATE_LIMIT_WINDOW_MS: '1000', RATE_LIMIT_REDIS_TIMEOUT_MS: '20',
      API_BODY_LIMIT_BYTES: '1024', TRUST_PROXY: 'false',
      JWT_ACCESS_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64),
    });
    ping = vi.spyOn(RedisCacheClient.prototype, 'ping').mockResolvedValue('PONG');
    consume = vi.spyOn(RedisCacheClient.prototype, 'consumeFixedWindow')
      .mockResolvedValue({ allowed: true, remaining: 1, retryAfterMs: 1_000 });
    limiter = new SecurityRateLimitService(config);
    tokens = new TokenService(config);
    const module = await Test.createTestingModule({
      controllers: [BoundaryController],
      providers: [
        { provide: TokenService, useValue: tokens },
        { provide: AuthService, useValue: { authenticatedUser } },
        { provide: JwtAuthGuard, useFactory: (tokenService: TokenService, auth: AuthService) => new JwtAuthGuard(tokenService, auth), inject: [TokenService, AuthService] },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    app.use(requestTelemetry('blockchain-explorer-api', new StructuredLogger({ service: 'security-test', format: 'json', level: 'error', sink: () => undefined })));
    configureHttpSecurity(app, config, limiter);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterEach(async () => { await app.close(); limiter.onModuleDestroy(); vi.restoreAllMocks(); authenticatedUser.mockClear(); });

  it('sets useful headers and request correlation before successful and rejected requests', async () => {
    const response = await fetch(`${base}/stats`, { headers: { 'x-request-id': 'security-test' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    expect(response.headers.get('x-request-id')).toBe('security-test');
    expect(response.headers.has('strict-transport-security')).toBe(false);
    expect(response.headers.has('x-powered-by')).toBe(false);
    const refused = await fetch(`${base}/stats`, { headers: { origin: 'http://localhost:3003.evil.test', 'x-request-id': 'rejected-request' } });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('x-request-id')).toBe('rejected-request');
    expect(refused.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('allows exact-origin bearer preflight without credential cookies or rate consumption', async () => {
    const response = await fetch(`${base}/auth/login`, { method: 'OPTIONS', headers: {
      origin: 'http://localhost:3003', 'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type,x-request-id',
    } });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3003');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    expect(consume).not.toHaveBeenCalled();
  });

  it('returns bounded generic malformed/oversize/compressed JSON errors with request IDs', async () => {
    const cases: Array<{ body: string | ArrayBuffer; headers?: Record<string, string>; status: number; message: string }> = [
      { body: '{"password":"secret', status: 400, message: 'Malformed JSON body' },
      { body: JSON.stringify({ password: 'x'.repeat(2_000) }), status: 413, message: 'Request body is too large' },
      { body: new Uint8Array(gzipSync('{"email":"test@example.test","password":"Password123!"}')).buffer, headers: { 'content-encoding': 'gzip' }, status: 415, message: 'Content encoding is not supported' },
    ];
    for (const test of cases) {
      const response = await fetch(`${base}/auth/login`, { method: 'POST', body: test.body, headers: { 'content-type': 'application/json', ...test.headers } });
      expect(response.status).toBe(test.status);
      expect(response.headers.get('x-request-id')).toBeTruthy();
      expect(await response.json()).toMatchObject({ statusCode: test.status, message: test.message });
    }
  });

  it('hides both HttpException and unexpected infrastructure details', async () => {
    for (const path of ['/failure', '/unexpected']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' });
    }
  });

  it('rejects missing, malformed, tampered and oversized JWT before authenticated user lookup', async () => {
    const valid = tokens.issue(user).accessToken;
    for (const authorization of [undefined, 'Bearer malformed.jwt.value', 'Basic abc', `Bearer ${valid.slice(0, -4)}aaaa`, `Bearer ${'a'.repeat(4097)}`]) {
      const response = await fetch(`${base}/secure`, { headers: authorization ? { authorization } : {} });
      expect(response.status).toBe(401);
    }
    expect(authenticatedUser).not.toHaveBeenCalled();
    expect((await fetch(`${base}/secure`, { headers: { authorization: `Bearer ${valid}` } })).status).toBe(200);
    expect(authenticatedUser).toHaveBeenCalledWith(user.id);
  });

  it('produces 429 with retry headers and shares one auth bucket across endpoints and spoofed proxy IPs', async () => {
    consume.mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 900 })
      .mockResolvedValueOnce({ allowed: true, remaining: 0, retryAfterMs: 1000 });
    const body = JSON.stringify({ email: user.email, password: 'Password123!' });
    const first = await fetch(`${base}/auth/login`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1' } });
    const second = await fetch(`${base}/auth/login/`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.2' } });
    expect(first.status).toBe(201);
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('1');
    expect(second.headers.get('ratelimit-remaining')).toBe('0');
    expect(second.headers.get('x-request-id')).toBeTruthy();
    expect(consume.mock.calls[0]?.[0]).toBe(consume.mock.calls[1]?.[0]);
    expect(consume.mock.calls[0]?.[0]).toMatch(/^auth:[a-f0-9]{64}$/);
    expect(consume.mock.calls[0]?.[1]).toBe(2);
    const register = await fetch(`${base}/auth/register`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.3' } });
    expect(register.status).toBe(429);
    expect(consume.mock.calls[2]?.[0]).toBe(consume.mock.calls[0]?.[0]);
  });

  it('fails closed for authentication and open for public reads when Redis is unavailable', async () => {
    ping.mockRejectedValue(new Error('Redis private URI/password'));
    const auth = await fetch(`${base}/auth/login`, { method: 'POST' });
    expect(auth.status).toBe(503);
    expect(await auth.json()).toMatchObject({ message: 'Authentication temporarily unavailable' });
    expect((await fetch(`${base}/search`)).status).toBe(200);
    expect((await fetch(`${base}/stats`)).status).toBe(200);
    expect(consume).not.toHaveBeenCalled();
  });

  it('bounds a stalled rate operation and uses finite group keys for distinct trace paths', async () => {
    consume.mockImplementation(() => new Promise(() => undefined));
    const start = performance.now();
    const response = await fetch(`${base}/tx/0x123/traces`);
    expect(response.status).toBe(200);
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(consume.mock.calls[0]?.[0]).toMatch(/^expensive:[a-f0-9]{64}$/);
    expect(consume.mock.calls[0]?.[0]).not.toContain('0x123');
  });
});

describe('security configuration and response privacy', () => {
  it.each(['*', 'null', 'https://web.test/path', 'https://user:password@web.test', 'https://web.test/'])('rejects non-origin CORS configuration %s', (origin) => {
    expect(() => readHttpSecurityConfig(new ConfigService({ WEB_ORIGIN: origin }))).toThrow();
  });

  it('requires production origin and rejects unlimited or hop-count proxy trust', () => {
    expect(() => readHttpSecurityConfig(new ConfigService({ NODE_ENV: 'production' }))).toThrow();
    for (const trust of [true, 'true', '1', '0.0.0.0/0']) {
      expect(() => readHttpSecurityConfig(new ConfigService({ TRUST_PROXY: trust }))).toThrow();
    }
    expect(readHttpSecurityConfig(new ConfigService({ TRUST_PROXY: 'loopback,uniquelocal' })).trustProxy).toEqual(['loopback', 'uniquelocal']);
  });

  it('bounds ENV limits and makes HSTS explicit and production-only', () => {
    for (const body of ['0', '-1', '2mb', '2000000']) {
      expect(() => readHttpSecurityConfig(new ConfigService({ API_BODY_LIMIT_BYTES: body }))).toThrow();
    }
    expect(readHttpSecurityConfig(new ConfigService({ NODE_ENV: 'development', SECURITY_HSTS_ENABLED: 'true' })).hsts).toBe(false);
    expect(readHttpSecurityConfig(new ConfigService({ NODE_ENV: 'production', WEB_ORIGIN: 'https://web.test', SECURITY_HSTS_ENABLED: 'true' })).hsts).toBe(true);
    expect(publicError(new ServiceUnavailableException('sensitive upstream information'))).toEqual({ statusCode: 503, message: 'Service unavailable', error: 'Service Unavailable' });
  });
});
