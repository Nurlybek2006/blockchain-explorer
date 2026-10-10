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

import * as schema from './schema/index.js';

@Injectable()
export class DatabaseService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger =
    new Logger(DatabaseService.name);

  private readonly pool: Pool;

  readonly db: NodePgDatabase<
    typeof schema
  >;

  constructor(
    private readonly configService: ConfigService,
  ) {
    const connectionString =
      this.configService.getOrThrow<string>(
        'PORTFOLIO_DATABASE_URL',
      );

    this.pool = new Pool({
      connectionString,

      max: Number(
        this.configService.get(
          'DB_POOL_MAX',
        ) ?? 10,
      ),

      idleTimeoutMillis: Number(
        this.configService.get(
          'DB_IDLE_TIMEOUT_MS',
        ) ?? 30_000,
      ),

      connectionTimeoutMillis: Number(
        this.configService.get(
          'DB_CONNECTION_TIMEOUT_MS',
        ) ?? 5_000,
      ),

      application_name:
        'blockchain-explorer-portfolio',
    });

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
    await this.pool.end();

    this.logger.log(
      'PostgreSQL connection pool closed',
    );
  }
}
// Portfolio Service үшін connection pool жасап, portfolio_db schema-ларын type-safe түрде береді.