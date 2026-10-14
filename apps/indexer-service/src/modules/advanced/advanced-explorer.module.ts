import { Module } from '@nestjs/common';
import { AdvancedExplorerRepository } from './advanced-explorer.repository.js';
import { AdvancedExplorerService } from './advanced-explorer.service.js';
import { AdvancedJobsService } from './advanced-jobs.service.js';
import { ContractDetectionService } from './contract-detection.service.js';
import { EtherscanClient } from './etherscan.client.js';

@Module({
  providers: [
    AdvancedExplorerRepository,
    AdvancedExplorerService,
    AdvancedJobsService,
    ContractDetectionService,
    EtherscanClient,
  ],
  exports: [AdvancedExplorerRepository, AdvancedExplorerService],
})
export class AdvancedExplorerModule {}
