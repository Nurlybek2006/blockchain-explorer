import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EthereumRpcClient } from '@blockchain-explorer/blockchain-client';
import { AdvancedExplorerRepository } from './advanced-explorer.repository.js';
import { loadAdvancedConfig, type AdvancedConfig } from './advanced.config.js';

export function codeHasContract(code: unknown): boolean {
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code))
    throw new Error('Invalid eth_getCode response');
  // All-zero bytes can still be valid EVM STOP bytecode.
  return code !== '0x';
}

@Injectable()
export class ContractDetectionService {
  private stopping = false;
  private readonly rpc: EthereumRpcClient;
  private readonly options: AdvancedConfig;
  constructor(
    private readonly repository: AdvancedExplorerRepository,
    config: ConfigService,
  ) {
    this.options = loadAdvancedConfig(config);
    this.rpc = new EthereumRpcClient({
      url: config.getOrThrow<string>('ETHEREUM_RPC_URL'),
      timeoutMs: 5000,
      maxRetries: 0,
      maxConcurrentRequests: 1,
      requestsPerSecond: 2,
    });
  }
  async processBatch(): Promise<void> {
    const rows = await this.repository.pendingDetections();
    for (const row of rows) {
      if (this.stopping) break;
      if (
        row.isContract ||
        row.codeCheckedBlock !== null ||
        row.lastSeenBlock === null
      )
        continue;
      try {
        const code = await this.rpc.getCode(row.address, row.lastSeenBlock);
        await this.repository.completeDetection(
          row.address,
          row.lastSeenBlock,
          codeHasContract(code),
          this.options,
        );
      } catch {
        await this.repository.failDetection(row.address);
      }
    }
  }
  stop(): void {
    this.stopping = true;
    this.rpc.close();
  }
}
