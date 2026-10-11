import {
  NestFactory,
} from '@nestjs/core';

import {
  ConfigService,
} from '@nestjs/config';

import {
  AppModule,
} from './app.module.js';

async function bootstrap() {
  const app =
    await NestFactory.create(
      AppModule,
    );

  /*
   * SIGINT / SIGTERM кезінде
   * worker мен DB pool дұрыс жабылады.
   */
  app.enableShutdownHooks();

  const config =
    app.get(
      ConfigService,
    );

  const port =
    Number(
      config.get(
        'INDEXER_PORT',
      ) ?? 3001,
    );

  await app.listen(
    port,
    '0.0.0.0',
  );
}

void bootstrap();
// Indexer серверін іске қосады және application жабылғанда worker/database cleanup орындалуын қамтамасыз етеді.