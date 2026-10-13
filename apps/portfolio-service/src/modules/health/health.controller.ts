import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';

import { DatabaseService } from '../../database/database.service.js';
import { PortfolioJobsService } from '../jobs/portfolio-jobs.service.js';
import { PortfolioEventsConsumer } from '../messaging/portfolio-events.consumer.js';
import { checkDependency } from '@blockchain-explorer/messaging';

@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jobs: PortfolioJobsService,
    private readonly events: PortfolioEventsConsumer,
  ) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      checkDependency(() => this.databaseService.ping()),
      checkDependency(() => this.jobs.ping()),
    ]);
    const rabbitmq = this.events.isConnected;
    const response = {
      status: database && redis && rabbitmq ? 'ok' : 'error',
      service: 'portfolio-service',
      database: database ? 'connected' : 'unavailable',
      redis: redis ? 'connected' : 'unavailable',
      rabbitmq: rabbitmq ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    };
    if (!database || !redis || !rabbitmq) throw new ServiceUnavailableException(response);
    return response;
  }
}
