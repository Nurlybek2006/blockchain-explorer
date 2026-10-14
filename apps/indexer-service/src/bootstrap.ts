import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { requestTelemetry } from '@blockchain-explorer/observability';
import type { TelemetryRuntime } from '@blockchain-explorer/observability/instrumentation';
import { AppModule } from './app.module.js';

export async function bootstrap(telemetry: TelemetryRuntime): Promise<void> {
  const app = await NestFactory.create({ module: AppModule, providers: [{ provide: 'TelemetryShutdown', useValue: { onApplicationShutdown: () => telemetry.shutdown() } }] }, { logger: telemetry.logger });
  app.enableShutdownHooks();
  app.use(requestTelemetry('blockchain-explorer-indexer', telemetry.logger));
  const config = app.get(ConfigService);
  await app.listen(Number(config.get('INDEXER_PORT') ?? 3001), '0.0.0.0');
}
