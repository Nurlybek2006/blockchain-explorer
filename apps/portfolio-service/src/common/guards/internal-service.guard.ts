import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const expected = this.config.getOrThrow<string>('INTERNAL_SERVICE_TOKEN');
    const provided = request.headers['x-internal-service-token'];

    // A duplicated authentication header is ambiguous and must be rejected.
    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException('Missing internal service token');
    }

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException('Invalid internal service token');
    }
    return true;
  }
}
