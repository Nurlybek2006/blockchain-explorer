import {
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import {
  drizzle,
  type NodePgDatabase,
} from 'drizzle-orm/node-postgres';

import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  readonly db: NodePgDatabase;

  constructor(
    private readonly configService: ConfigService,
  ) {
    const connectionString =
      this.configService.get<string>(
        'EXPLORER_DATABASE_URL',
      );

    if (!connectionString) {
      throw new Error(
        'EXPLORER_DATABASE_URL is not defined',
      );
    }

    this.pool = new Pool({
      connectionString,
    });

    this.db = drizzle({
      client: this.pool,
    });
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`SELECT 1`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}