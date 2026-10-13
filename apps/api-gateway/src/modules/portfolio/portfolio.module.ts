import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PortfolioClient } from './portfolio.client.js';
import { PortfolioController } from './portfolio.controller.js';
import { PortfolioService } from './portfolio.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PortfolioController],
  providers: [PortfolioClient, PortfolioService],
})
export class PortfolioModule {}
