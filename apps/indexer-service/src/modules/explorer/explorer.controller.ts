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
  ) {}

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
      blockNumber =
        BigInt(value);
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
    !Number.isInteger(
      page,
    ) ||
    page < 1
  ) {
    throw new BadRequestException(
      'page must be >= 1',
    );
  }

  if (
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