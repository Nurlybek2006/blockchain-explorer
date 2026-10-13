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
  ExplorerService,
} from './explorer.service.js';

@Controller()
export class ExplorerController {
  constructor(
    private readonly explorer:
      ExplorerService,
  ) { }

  @Get('stats')
  stats() {
    return this.explorer
      .getStats();
  }

  @Get('blocks')
  blocks(
    @Query()
    query:
      PaginationQueryDto,
  ) {
    return this.explorer
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

    return this.explorer
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

    return this.explorer
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

    return this.explorer
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
    return this.explorer
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

    return this.explorer
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