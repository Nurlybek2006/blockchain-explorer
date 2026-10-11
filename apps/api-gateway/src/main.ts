import {
  ValidationPipe,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  NestFactory,
} from '@nestjs/core';

import {
  AppModule,
} from './app.module.js';

async function bootstrap() {
  const app =
    await NestFactory.create(
      AppModule,
    );

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      transform:
        true,

      whitelist:
        true,

      forbidNonWhitelisted:
        true,
    }),
  );

  const config =
    app.get(
      ConfigService,
    );

  const webOrigin =
    config.get<string>(
      'WEB_ORIGIN',
    ) ??
    'http://localhost:3003';

  app.enableCors({
    origin:
      webOrigin,

    credentials:
      true,
  });

  const port =
    Number(
      config.get(
        'API_GATEWAY_PORT',
      ) ??
        3000,
    );

  await app.listen(
    port,
    '0.0.0.0',
  );
}

void bootstrap();
// Validation, CORS, graceful shutdown және environment-based port конфигурациясын бірден қосады.