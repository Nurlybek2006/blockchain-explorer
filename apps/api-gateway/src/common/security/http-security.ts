import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter, isBodyParserError, publicError } from './api-exception.filter.js';
import { readHttpSecurityConfig, type HttpSecurityConfig } from './http-security.config.js';
import type { SecurityRateLimitService } from './security-rate-limit.service.js';

export function securityHeaders(config: HttpSecurityConfig) {
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.removeHeader('X-Powered-By');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (config.hsts) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

export function originBoundary(webOrigin: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== webOrigin) {
      response.status(403).json({ statusCode: 403, message: 'Origin is not allowed', error: 'Forbidden' });
      return;
    }
    next();
  };
}

/** Called after requestTelemetry and before registering the JSON parser. */
export function configureHttpSecurity(app: NestExpressApplication, config: ConfigService, limiter: SecurityRateLimitService): void {
  const settings = readHttpSecurityConfig(config);
  app.set('trust proxy', settings.trustProxy);
  app.use(securityHeaders(settings));
  app.use(originBoundary(settings.webOrigin));
  app.enableCors({
    origin: settings.webOrigin, credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 600, optionsSuccessStatus: 204,
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    void limiter.handle(request, response, next).catch(next);
  });
  app.useBodyParser('json', { limit: settings.bodyLimitBytes, strict: true, inflate: false });
  // Nest wraps parser SyntaxError in a BadRequestException; sanitize before that conversion.
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction): void => {
    if (!isBodyParserError(error)) { next(error); return; }
    const body = publicError(error);
    response.status(body.statusCode).json(body);
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
