import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthService } from '../auth.service.js';
import { TokenService } from '../token.service.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/i.exec(authorization) : null;
    const rawToken = match?.[1];
    if (!rawToken || rawToken.length > 4096) throw new UnauthorizedException('Access token is required');
    const claims = this.tokens.verifyAccess(rawToken);
    request.user = await this.auth.authenticatedUser(claims.sub);
    return true;
  }
}
