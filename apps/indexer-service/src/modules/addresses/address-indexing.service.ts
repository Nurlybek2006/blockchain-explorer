import {
  Injectable,
} from '@nestjs/common';

import {
  normalizeAddress,
  type RpcBlock,
  type RpcTransaction,
  type RpcTransactionReceipt,
} from '@blockchain-explorer/blockchain-client';

import {
  addresses,
} from '../../database/schema/index.js';

import type {
  PreparedTokenTransfer,
} from '../tokens/token-indexing.service.js';

export type PreparedAddress =
  typeof addresses.$inferInsert;

interface AddressActivity {
  isContract: boolean;
}

@Injectable()
export class AddressIndexingService {
  prepare(
    block:
      RpcBlock<RpcTransaction>,

    receipts:
      RpcTransactionReceipt[],

    transfers:
      PreparedTokenTransfer[],

    blockNumber: bigint,
  ): PreparedAddress[] {
    const activity =
      new Map<
        string,
        AddressActivity
      >();

    const touch = (
      rawAddress:
        string | null | undefined,

      isContract = false,
    ) => {
      const address =
        normalizeAddress(
          rawAddress,
        );

      if (!address) {
        return;
      }

      const existing =
        activity.get(
          address,
        );

      if (existing) {
        if (isContract) {
          existing.isContract =
            true;
        }

        return;
      }

      activity.set(
        address,
        {
          isContract,
        },
      );
    };

    for (
      const transaction of
      block.transactions
    ) {
      touch(
        transaction.from,
      );

      touch(
        transaction.to,
      );
    }

    for (
      const receipt of
      receipts
    ) {
      if (
        receipt
          .contractAddress
      ) {
        touch(
          receipt
            .contractAddress,

          true,
        );
      }
    }

    for (
      const transfer of
      transfers
    ) {
      touch(
        transfer
          .fromAddress,
      );

      touch(
        transfer
          .toAddress,
      );

      touch(
        transfer
          .tokenAddress,

        true,
      );
    }

    const now =
      new Date();

    return [
      ...activity.entries(),
    ].map(
      ([
        address,
        info,
      ]) => ({
        address,

        isContract:
          info.isContract,

        firstSeenBlock:
          blockNumber,

        lastSeenBlock:
          blockNumber,

        createdAt:
          now,

        updatedAt:
          now,
      }),
    );
  }
}
// Block ішінде кездескен wallet және contract address-терді анықтап, address registry үшін дайындайды.