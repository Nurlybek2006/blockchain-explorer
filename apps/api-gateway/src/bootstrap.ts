import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { requestTelemetry } from '@blockchain-explorer/observability';
import type { TelemetryRuntime } from '@blockchain-explorer/observability/instrumentation';
import { AppModule } from './app.module.js';

export async function bootstrap(telemetry: TelemetryRuntime): Promise<void> {
  const app = await NestFactory.create({ module: AppModule, providers: [{ provide: 'TelemetryShutdown', useValue: { onApplicationShutdown: () => telemetry.shutdown() } }] }, { logger: telemetry.logger });
  app.enableShutdownHooks();
  app.use(requestTelemetry('blockchain-explorer-api', telemetry.logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3003', credentials: true });
  await app.listen(Number(config.get('API_GATEWAY_PORT') ?? 3000), '0.0.0.0');
}
