import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';

import {
  PaginationQueryDto,
} from './dto/pagination-query.dto.js';

import {
  IndexerExplorerClient,
} from './indexer-explorer.client.js';

@Controller()
export class ExplorerController {
  constructor(
    private readonly indexer:
      IndexerExplorerClient,
  ) {}

  @Get('stats')
  stats() {
    return this.indexer
      .getStats();
  }

  @Get('blocks')
  blocks(
    @Query()
    query:
      PaginationQueryDto,
  ) {
    return this.indexer
      .getBlocks(
        query.page,
        query.limit,
      );
  }

  @Get('blocks/:number')
  block(
    @Param('number')
    number: string,
  ) {
    if (
      !/^\d+$/.test(
        number,
      )
    ) {
      throw new BadRequestException(
        'Invalid block number',
      );
    }

    return this.indexer
      .getBlock(
        number,
      );
  }

  @Get('tx/:hash')
  transaction(
    @Param('hash')
    hash: string,
  ) {
    if (
      !/^0x[a-fA-F0-9]{64}$/.test(
        hash,
      )
    ) {
      throw new BadRequestException(
        'Invalid transaction hash',
      );
    }

    return this.indexer
      .getTransaction(
        hash.toLowerCase(),
      );
  }

  @Get(
    'address/:address',
  )
  address(
    @Param('address')
    address: string,

    @Query()
    query:
      PaginationQueryDto,
  ) {
    validateAddress(
      address,
    );

    return this.indexer
      .getAddress(
        address.toLowerCase(),
        query.page,
        query.limit,
      );
  }

  @Get('tokens')
  tokens(
    @Query()
    query:
      PaginationQueryDto,
  ) {
    return this.indexer
      .getTokens(
        query.page,
        query.limit,
      );
  }

  @Get(
    'token/:address',
  )
  token(
    @Param('address')
    address: string,

    @Query()
    query:
      PaginationQueryDto,
  ) {
    validateAddress(
      address,
    );

    return this.indexer
      .getToken(
        address.toLowerCase(),
        query.page,
        query.limit,
      );
  }
}

function validateAddress(
  address: string,
) {
  if (
    !/^0x[a-fA-F0-9]{40}$/.test(
      address,
    )
  ) {
    throw new BadRequestException(
      'Invalid Ethereum address',
    );
  }
}
// Frontend қолданатын public Blockchain Explorer REST API endpoint-терін береді.