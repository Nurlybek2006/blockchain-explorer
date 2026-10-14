import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { requestTelemetry } from '@blockchain-explorer/observability';
import type { TelemetryRuntime } from '@blockchain-explorer/observability/instrumentation';
import { AppModule } from './app.module.js';
import { configureHttpSecurity } from './common/security/http-security.js';
import { SecurityRateLimitService } from './common/security/security-rate-limit.service.js';

export async function bootstrap(telemetry: TelemetryRuntime): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>({ module: AppModule, providers: [{ provide: 'TelemetryShutdown', useValue: { onApplicationShutdown: () => telemetry.shutdown() } }] }, { logger: telemetry.logger, bodyParser: false });
  app.enableShutdownHooks();
  app.use(requestTelemetry('blockchain-explorer-api', telemetry.logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const config = app.get(ConfigService);
  configureHttpSecurity(app, config, app.get(SecurityRateLimitService));
  await app.listen(Number(config.get('API_GATEWAY_PORT') ?? 3000), '0.0.0.0');
}
