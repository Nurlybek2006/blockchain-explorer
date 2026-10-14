import {
  Injectable,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  CacheService,
} from '../cache/cache.service.js';

import {
  IndexerExplorerClient,
} from './indexer-explorer.client.js';
import { decodeBlockDetail, decodeContract, decodeNetworkStatus, decodeTraces } from './advanced-explorer.decoder.js';

@Injectable()
export class ExplorerService {
  private readonly statsTtl:
    number;

  private readonly listTtl:
    number;

  private readonly detailTtl:
    number;

  constructor(
    private readonly indexer:
      IndexerExplorerClient,

    private readonly cache:
      CacheService,

    config:
      ConfigService,
  ) {
    this.statsTtl =
      Number(
        config.get(
          'CACHE_STATS_TTL_SECONDS',
        ) ??
          5,
      );

    this.listTtl =
      Number(
        config.get(
          'CACHE_LIST_TTL_SECONDS',
        ) ??
          10,
      );

    this.detailTtl =
      Number(
        config.get(
          'CACHE_DETAIL_TTL_SECONDS',
        ) ??
          60,
      );
  }

  getStats() {
    return this.cache
      .remember(
        'explorer:stats',

        this.statsTtl,

        () =>
          this.indexer
            .getStats(),
      );
  }

  getBlocks(
    page: number,
    limit: number,
  ) {
    return this.cache
      .remember(
        `explorer:blocks:${page}:${limit}`,

        this.listTtl,

        () =>
          this.indexer
            .getBlocks(
              page,
              limit,
            ),
      );
  }

  getBlock(
    number: string,
  ) {
    return this.cache
      .remember(
        `explorer:block:${number}`,

        this.detailTtl,

        () =>
          this.indexer
            .getBlock(
              number,
            ),
      );
  }

  getTransaction(
    hash: string,
  ) {
    return this.cache
      .remember(
        `explorer:tx:${hash}`,

        this.detailTtl,

        () =>
          this.indexer
            .getTransaction(
              hash,
            ),
      );
  }

  getAddress(
    address: string,
    page: number,
    limit: number,
  ) {
    return this.cache
      .remember(
        `explorer:address:${address}:${page}:${limit}`,

        this.listTtl,

        () =>
          this.indexer
            .getAddress(
              address,
              page,
              limit,
            ),
      );
  }

  getTokens(
    page: number,
    limit: number,
  ) {
    return this.cache
      .remember(
        `explorer:tokens:${page}:${limit}`,

        this.listTtl,

        () =>
          this.indexer
            .getTokens(
              page,
              limit,
            ),
      );
  }

  getToken(
    address: string,
    page: number,
    limit: number,
  ) {
    return this.cache
      .remember(
        `explorer:token:${address}:${page}:${limit}`,

        this.listTtl,

        () =>
          this.indexer
            .getToken(
              address,
              page,
              limit,
            ),
      );
  }

  getContract(address: string) {
    return this.cache.remember(`explorer:contract:${address}`, this.listTtl, () => this.indexer.getContract(address), decodeContract);
  }

  getTraces(hash: string) {
    return this.cache.remember(`explorer:traces:${hash}`, this.statsTtl, () => this.indexer.getTraces(hash), decodeTraces);
  }

  getBlockByHash(hash: string) {
    return this.cache.remember(`explorer:block-hash:${hash}`, this.detailTtl, () => this.indexer.getBlockByHash(hash), decodeBlockDetail);
  }

  search(q: string) { return this.indexer.search(q); }

  getNetworkStatus() {
    return this.cache.remember('explorer:network-status', this.statsTtl, () => this.indexer.getNetworkStatus(), decodeNetworkStatus);
  }
}
// Explorer request-теріне Redis caching қосады. Бір data қайта-қайта сұралса Indexer мен PostgreSQL-ға unnecessary query бармайды.
