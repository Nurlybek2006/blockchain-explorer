import {
  Injectable,
} from '@nestjs/common';

import {
  createEventEnvelope,
  EVENT_TYPES,
} from '@blockchain-explorer/contracts';

import type {
  PreparedTokenTransfer,
  PreparedToken,
} from '../tokens/token-indexing.service.js';

@Injectable()
export class IndexerEventFactory {
  createBlockIndexed(
    input: {
      chainId: number;

      networkName: string;

      blockNumber: bigint;

      blockHash: string;

      parentHash: string;

      timestamp: Date;

      transactionCount: number;

      logCount: number;

      tokenTransfers:
        PreparedTokenTransfer[];
    },
  ) {
    return createEventEnvelope(
      EVENT_TYPES
        .BLOCK_INDEXED,

      'indexer-service',

      {
        chainId:
          input.chainId,

        networkName:
          input.networkName,

        blockNumber:
          input.blockNumber
            .toString(),

        blockHash:
          input.blockHash,

        parentHash:
          input.parentHash,

        timestamp:
          input.timestamp
            .toISOString(),

        transactionCount:
          input
            .transactionCount,

        logCount:
          input.logCount,

        tokenTransferCount:
          input
            .tokenTransfers
            .length,
      },
    );
  }

  createTokenTransfers(
    chainId: number,
    networkName: string,
    transfers: PreparedTokenTransfer[],
    tokenMetadata: PreparedToken[] = [],
  ) {
    const metadataByAddress = new Map(tokenMetadata.map((token) => [token.address.toLowerCase(), token]));
    return transfers.map((transfer) => {
      const metadata = metadataByAddress.get(transfer.tokenAddress.toLowerCase());
      return createEventEnvelope(EVENT_TYPES.TOKEN_TRANSFER_INDEXED, 'indexer-service', {
        chainId,
        networkName,
        blockNumber: transfer.blockNumber.toString(),
        transactionHash: transfer.transactionHash,
        transactionIndex: transfer.transactionIndex,
        logIndex: transfer.logIndex,
        tokenAddress: transfer.tokenAddress,
        fromAddress: transfer.fromAddress,
        toAddress: transfer.toAddress,
        amountRaw: transfer.amount,
        ...(typeof metadata?.decimals === 'number' && Number.isInteger(metadata.decimals) && metadata.decimals >= 0 && metadata.decimals <= 255 ? { tokenDecimals: metadata.decimals } : {}),
        ...(typeof metadata?.symbol === 'string' && metadata.symbol.length <= 64 ? { tokenSymbol: metadata.symbol } : {}),
      });
    });
  }
}
// Indexer database data-дан versioned RabbitMQ event-тер құрады.
