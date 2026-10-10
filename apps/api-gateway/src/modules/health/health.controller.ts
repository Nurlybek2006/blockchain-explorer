import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';

import { DatabaseService } from '../../database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseService: DatabaseService,
  ) {}

  @Get()
  async check() {
    try {
      await this.databaseService.ping();

      return {
        status: 'ok',
        service: 'api-gateway',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'api-gateway',
        database: 'unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  }
}