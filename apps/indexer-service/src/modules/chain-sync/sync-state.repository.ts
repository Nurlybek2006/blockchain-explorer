import {
  Injectable,
} from '@nestjs/common';

import {
  eq,
} from 'drizzle-orm';

import {
  DatabaseService,
} from '../../database/database.service.js';

import {
  syncState,
} from '../../database/schema/index.js';

@Injectable()
export class SyncStateRepository {
  constructor(
    private readonly database:
      DatabaseService,
  ) {}

  async find(
    chainId: number,
  ) {
    const [state] =
      await this.database.db
        .select()
        .from(syncState)
        .where(
          eq(
            syncState.chainId,
            chainId,
          ),
        )
        .limit(1);

    return state ?? null;
  }

  async getOrCreate(
    chainId: number,
    networkName: string,
    lastScannedBlock: bigint,
  ) {
    await this.database.db
      .insert(syncState)
      .values({
        chainId,

        networkName,

        lastScannedBlock:
          lastScannedBlock
            .toString(),

        lastFinalizedBlock:
          lastScannedBlock >
          0n
            ? lastScannedBlock
                .toString()
            : '0',

        status:
          'starting',

        updatedAt:
          new Date(),
      })
      .onConflictDoNothing();

    const state =
      await this.find(
        chainId,
      );

    if (!state) {
      throw new Error(
        `Could not initialize sync state for chain ${chainId}`,
      );
    }

    return state;
  }
}
// Indexer қай block-қа дейін жеткенін PostgreSQL-дан оқиды және алғашқы sync state-ті жасайды.