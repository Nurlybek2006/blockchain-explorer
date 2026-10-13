import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';

import { DatabaseService } from '../../database/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { checkDependency } from '@blockchain-explorer/messaging';

@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      checkDependency(() => this.databaseService.ping()),
      checkDependency(() => this.cache.ping()),
    ]);
    const response = {
      status: database && redis ? 'ok' : 'error',
      service: 'api-gateway',
      database: database ? 'connected' : 'unavailable',
      redis: redis ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    };
    if (!database || !redis) throw new ServiceUnavailableException(response);
    return response;
  }
}
