import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ExplorerQueryService,
} from './explorer-query.service.js';

import {
  InternalServiceGuard,
} from '../../common/guards/internal-service.guard.js';

import {
  jsonSafe,
} from '../../common/utils/json-safe.js';
import { AdvancedExplorerService } from '../advanced/advanced-explorer.service.js';
import { NetworkStatusService } from './network-status.service.js';
import { SearchInputError } from './search-resolution.js';

@Controller(
  'internal/explorer',
)
@UseGuards(
  InternalServiceGuard,
)
export class ExplorerController {
  constructor(
    private readonly explorer:
      ExplorerQueryService,
    private readonly advanced: AdvancedExplorerService,
    private readonly network: NetworkStatusService,
  ) { }

  @Get('network/status')
  networkStatus() { return this.network.getStatus(); }

  @Get('search')
  async search(@Query('q') query: unknown) {
    try { const result = await this.explorer.search(query); if (!result) throw new NotFoundException('Indexed resource not found'); return result; }
    catch (error) { if (error instanceof SearchInputError) throw new BadRequestException(error.message); throw error; }
  }

  @Get('contracts/:address')
  async contract(@Param('address') address: string) {
    validateAddress(address); const result = await this.advanced.getContract(address.toLowerCase());
    if (!result) throw new NotFoundException('Indexed contract not found'); return result;
  }

  @Get('transactions/:hash/traces')
  async traces(@Param('hash') hash: string) { validateHash(hash); return this.advanced.getTraces(hash.toLowerCase()); }

  @Get('blocks/hash/:hash')
  async blockHash(@Param('hash') hash: string) {
    validateHash(hash); const result = await this.explorer.getBlockByHash(hash); if (!result) throw new NotFoundException('Block not found'); return jsonSafe(result);
  }

  @Get('stats')
  async stats() {
    return jsonSafe(
      await this.explorer
        .getStats(),
    );
  }

  @Get('blocks')
  async blocks(
    @Query('page')
    pageRaw?: string,

    @Query('limit')
    limitRaw?: string,
  ) {
    const {
      page,
      limit,
    } =
      parsePagination(
        pageRaw,
        limitRaw,
      );

    return jsonSafe(
      await this.explorer
        .getBlocks(
          page,
          limit,
        ),
    );
  }

  @Get(
    'blocks/:number',
  )
  async block(
    @Param('number')
    value: string,
  ) {
    let blockNumber:
      bigint;

    try {
      if (!/^\d+$/.test(value) || value.length > 19) throw new Error('Invalid block number');
      blockNumber =
        BigInt(value);
      if (blockNumber > 9223372036854775807n) throw new Error('Invalid block number');
    } catch {
      throw new BadRequestException(
        'Invalid block number',
      );
    }

    const block =
      await this.explorer
        .getBlock(
          blockNumber,
        );

    if (!block) {
      throw new NotFoundException(
        'Block not found',
      );
    }

    return jsonSafe(
      block,
    );
  }

  @Get(
    'transactions/:hash',
  )
  async transaction(
    @Param('hash')
    hash: string,
  ) {
    validateHash(
      hash,
    );

    const result =
      await this.explorer
        .getTransaction(
          hash,
        );

    if (!result) {
      throw new NotFoundException(
        'Transaction not found',
      );
    }

    return jsonSafe(
      result,
    );
  }

  @Get(
    'addresses/:address',
  )
  async address(
    @Param('address')
    address: string,

    @Query('page')
    pageRaw?: string,

    @Query('limit')
    limitRaw?: string,
  ) {
    validateAddress(
      address,
    );

    const {
      page,
      limit,
    } =
      parsePagination(
        pageRaw,
        limitRaw,
      );

    const result =
      await this.explorer
        .getAddress(
          address,
          page,
          limit,
        );

    if (!result) {
      throw new NotFoundException(
        'Address not found',
      );
    }

    return jsonSafe(
      result,
    );
  }

  @Get('tokens')
  async tokens(
    @Query('page')
    pageRaw?: string,

    @Query('limit')
    limitRaw?: string,
  ) {
    const {
      page,
      limit,
    } =
      parsePagination(
        pageRaw,
        limitRaw,
      );

    return jsonSafe(
      await this.explorer
        .getTokens(
          page,
          limit,
        ),
    );
  }

  @Get(
    'tokens/:address',
  )
  async token(
    @Param('address')
    address: string,

    @Query('page')
    pageRaw?: string,

    @Query('limit')
    limitRaw?: string,
  ) {
    validateAddress(
      address,
    );

    const {
      page,
      limit,
    } =
      parsePagination(
        pageRaw,
        limitRaw,
      );

    const result =
      await this.explorer
        .getToken(
          address,
          page,
          limit,
        );

    if (!result) {
      throw new NotFoundException(
        'Token not found',
      );
    }

    return jsonSafe(
      result,
    );
  }

  @Get('addresses/:address/activity')
  async activity(
    @Param('address') address: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    validateAddress(address);

    const { page, limit } = parsePagination(pageRaw, limitRaw);

    return this.explorer.getActivity(
      address.toLowerCase(),
      page,
      limit,
    );
  }
}

function parsePagination(
  pageRaw?: string,
  limitRaw?: string,
) {
  const page =
    Number(
      pageRaw ?? 1,
    );

  const limit =
    Number(
      limitRaw ?? 20,
    );

  if (
    (pageRaw !== undefined && (typeof pageRaw !== 'string' || !/^\d{1,7}$/.test(pageRaw))) ||
    !Number.isInteger(
      page,
    ) ||
    page < 1 || page > 1_000_000
  ) {
    throw new BadRequestException(
      'page must be between 1 and 1000000',
    );
  }

  if (
    (limitRaw !== undefined && (typeof limitRaw !== 'string' || !/^\d{1,3}$/.test(limitRaw))) ||
    !Number.isInteger(
      limit,
    ) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new BadRequestException(
      'limit must be between 1 and 100',
    );
  }

  return {
    page,
    limit,
  };
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

function validateHash(
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
}
// Indexer ішіндегі protected REST API. API Gateway осы endpoint-тер арқылы explorer database-ты оқиды.
