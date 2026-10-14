import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  timingSafeEqual,
} from 'node:crypto';

@Injectable()
export class InternalServiceGuard
  implements CanActivate
{
  constructor(
    private readonly config:
      ConfigService,
  ) {}

  canActivate(
    context:
      ExecutionContext,
  ): boolean {
    const request =
      context
        .switchToHttp()
        .getRequest<{
          headers:
            Record<
              string,
              string |
              string[] |
              undefined
            >;
        }>();

    const expected =
      this.config
        .getOrThrow<string>(
          'INTERNAL_SERVICE_TOKEN',
        );

    const raw =
      request.headers[
        'x-internal-service-token'
      ];

    const provided = typeof raw === 'string' ? raw : undefined;

    if (
      !provided
    ) {
      throw new UnauthorizedException(
        'Missing internal service token',
      );
    }

    const expectedBuffer =
      Buffer.from(
        expected,
      );

    const providedBuffer =
      Buffer.from(
        provided,
      );

    if (
      expectedBuffer.length !==
      providedBuffer.length
    ) {
      throw new UnauthorizedException(
        'Invalid internal service token',
      );
    }

    const valid =
      timingSafeEqual(
        expectedBuffer,
        providedBuffer,
      );

    if (!valid) {
      throw new UnauthorizedException(
        'Invalid internal service token',
      );
    }

    return true;
  }
}
// Indexer internal API-ға тек API Gateway кіре алатындай shared token тексереді.
