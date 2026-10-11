import {
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  EthereumRpcClient,
} from '@blockchain-explorer/blockchain-client';

import {
  IndexerConfigService,
} from '../../config/indexer-config.service.js';

import {
  BlockProcessorService,
} from './block-processor.service.js';

import {
  ReorgService,
} from './reorg.service.js';

import {
  SyncStateRepository,
} from './sync-state.repository.js';

@Injectable()
export class ChainSyncService {
  private readonly logger =
    new Logger(
      ChainSyncService.name,
    );

  private initialized =
    false;

  private chainId = 0;

  private networkName =
    'unknown';

  constructor(
    private readonly rpc:
      EthereumRpcClient,

    private readonly config:
      IndexerConfigService,

    private readonly syncState:
      SyncStateRepository,

    private readonly processor:
      BlockProcessorService,

    private readonly reorg:
      ReorgService,
  ) {}

  async initialize():
    Promise<void> {
    if (
      this.initialized
    ) {
      return;
    }

    const chainId =
      await this.rpc
        .getChainId();

    if (
      chainId !==
      this.config
        .expectedChainId
    ) {
      throw new Error(
        `Wrong Ethereum network. Expected chainId=${this.config.expectedChainId}, received chainId=${chainId}`,
      );
    }

    this.chainId =
      chainId;

    this.networkName =
      getNetworkName(
        chainId,
      );

    const latestBlock =
      await this.rpc
        .getBlockNumber();

    const confirmedHead =
      this.calculateConfirmedHead(
        latestBlock,
      );

    const startBlock =
      this.config
        .startBlock;

    let initialLastScanned:
      bigint;

    if (
      startBlock ===
      'latest'
    ) {
      initialLastScanned =
        confirmedHead >
        0n
          ? confirmedHead -
            1n
          : -1n;
    } else {
      initialLastScanned =
        startBlock >
        0n
          ? startBlock -
            1n
          : -1n;
    }

    const state =
      await this.syncState
        .getOrCreate(
          chainId,
          this.networkName,
          initialLastScanned,
        );

    this.logger.log(
      `Ethereum RPC connected`,
    );

    this.logger.log(
      `Network: ${this.networkName} (${chainId})`,
    );

    this.logger.log(
      `Latest block: ${latestBlock}`,
    );

    this.logger.log(
      `Indexer state: ${state.lastScannedBlock}`,
    );

    this.initialized =
      true;
  }

  async syncNextBatch():
    Promise<boolean> {
    await this.initialize();

    const latestBlock =
      await this.rpc
        .getBlockNumber();

    const confirmedHead =
      this.calculateConfirmedHead(
        latestBlock,
      );

    const state =
      await this.syncState.find(
        this.chainId,
      );

    if (!state) {
      throw new Error(
        'Indexer sync state is missing',
      );
    }

    const lastScanned =
      BigInt(
        state.lastScannedBlock,
      );

    const nextBlock =
      lastScanned + 1n;

    if (
      nextBlock >
      confirmedHead
    ) {
      return false;
    }

    const batchEndCandidate =
      nextBlock +
      BigInt(
        this.config
          .batchSize -
          1,
      );

    const batchEnd =
      batchEndCandidate <
      confirmedHead
        ? batchEndCandidate
        : confirmedHead;

    this.logger.log(
      `Scanning blocks ${nextBlock} -> ${batchEnd}`,
    );

    for (
      let blockNumber =
        nextBlock;
      blockNumber <=
      batchEnd;
      blockNumber += 1n
    ) {
      const block =
        await this.rpc
          .getBlockByNumber(
            blockNumber,
            true,
          );

      if (
        !block ||
        !block.hash ||
        !block.number
      ) {
        throw new Error(
          `Block ${blockNumber} not found`,
        );
      }

      const reorgHandled =
        await this.reorg
          .ensureCanonicalParent(
            this.chainId,
            block,
          );

      /*
       * Reorg state-ті артқа
       * жылжытты.
       *
       * Келесі loop жаңа
       * state-тен басталады.
       */
      if (
        reorgHandled
      ) {
        return true;
      }

      await this.processor
        .process(
          this.chainId,
          this.networkName,
          block,
          confirmedHead,
        );
    }

    return true;
  }

  private calculateConfirmedHead(
    latestBlock: bigint,
  ): bigint {
    const confirmations =
      BigInt(
        this.config
          .confirmations,
      );

    if (
      latestBlock <=
      confirmations
    ) {
      return 0n;
    }

    return (
      latestBlock -
      confirmations
    );
  }
}

function getNetworkName(
  chainId: number,
): string {
  switch (chainId) {
    case 1:
      return 'ethereum-mainnet';

    case 11155111:
      return 'ethereum-sepolia';

    default:
      return `ethereum-${chainId}`;
  }
}
// Ethereum-ның latest block-ын анықтап, Indexer қай жерге дейін жеткенін салыстырып, block-тарды ретімен өңдейді.