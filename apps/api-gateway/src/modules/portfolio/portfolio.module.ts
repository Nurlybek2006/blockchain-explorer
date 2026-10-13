import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntelligenceModule } from '../intelligence/intelligence.module.js';
import { PortfolioClient } from './portfolio.client.js';
import { PortfolioController } from './portfolio.controller.js';
import { PortfolioService } from './portfolio.service.js';

@Module({
  imports: [AuthModule, IntelligenceModule],
  controllers: [PortfolioController],
  providers: [PortfolioClient, PortfolioService],
})
export class PortfolioModule {}
