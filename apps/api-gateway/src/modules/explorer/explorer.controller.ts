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

  @Get('blocks/hash/:hash')
  blockByHash(@Param('hash') hash: string) {
    validateHash(hash);
    return this.explorer.getBlockByHash(hash.toLowerCase());
  }

  @Get('contract/:address')
  contract(@Param('address') address: string) {
    validateAddress(address);
    return this.explorer.getContract(address.toLowerCase());
  }

  @Get('tx/:hash/traces')
  traces(@Param('hash') hash: string) {
    validateHash(hash);
    return this.explorer.getTraces(hash.toLowerCase());
  }

  @Get('search')
  search(@Query('q') q: unknown) {
    if (typeof q !== 'string' || q.trim().length === 0 || q.trim().length > 100) throw new BadRequestException('Invalid search query');
    return this.explorer.search(q.trim());
  }

  @Get('network/status')
  networkStatus() { return this.explorer.getNetworkStatus(); }

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

function validateHash(hash: string): void {
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new BadRequestException('Invalid Ethereum hash');
}
// Frontend қолданатын public Blockchain Explorer REST API endpoint-терін береді.
