import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import {
  drizzle,
  type NodePgDatabase,
} from 'drizzle-orm/node-postgres';

import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { databasePoolConfiguration } from '@blockchain-explorer/contracts';
import { registerPoolMetrics } from '@blockchain-explorer/observability';

import * as schema from './schema/index.js';

@Injectable()
export class DatabaseService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger =
    new Logger(DatabaseService.name);

  private readonly pool: Pool;
  private readonly unregisterPoolMetrics: () => void;

  readonly db: NodePgDatabase<
    typeof schema
  >;

  constructor(
    private readonly configService: ConfigService,
  ) {
    const connectionString =
      this.configService.getOrThrow<string>(
        'EXPLORER_DATABASE_URL',
      );

    this.pool = new Pool({
      connectionString,

      ...databasePoolConfiguration((key) => this.configService.get<unknown>(key)),

      application_name:
        'blockchain-explorer-indexer',
    });
    this.unregisterPoolMetrics = registerPoolMetrics(this.pool, 'explorer_db');

    this.pool.on(
      'error',
      (error: Error) => {
        this.logger.error(
          'Unexpected PostgreSQL pool error',
          error.stack,
        );
      },
    );

    this.db = drizzle(
      this.pool,
      {
        schema,
      },
    );
  }

  async onModuleInit(): Promise<void> {
    await this.ping();

    this.logger.log(
      'PostgreSQL connection established',
    );
  }

  async ping(): Promise<void> {
    await this.db.execute(
      sql`SELECT 1`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.unregisterPoolMetrics();
    await this.pool.end();

    this.logger.log(
      'PostgreSQL connection pool closed',
    );
  }
}

// Indexer-ді тек explorer_db database-ына байланыстырады.
