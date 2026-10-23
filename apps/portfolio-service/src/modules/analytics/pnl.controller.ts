import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { PortfolioOwnerDto, PortfolioPaginationDto } from '../portfolios/dto/portfolio.dto.js';
import { PortfolioTradeDto } from './dto/trade.dto.js';
import { PnlService } from './pnl.service.js';

@Controller('internal/portfolios')
@UseGuards(InternalServiceGuard)
export class PnlController {
  constructor(private readonly pnl: PnlService) {}
  @Get(':id/pnl')
  summary(@Param('id', new ParseUUIDPipe()) id: string, @Query() owner: PortfolioOwnerDto) { return this.pnl.summary(owner.userId, id); }
  @Get(':id/trades')
  list(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioPaginationDto) { return this.pnl.list(query.userId, id, query.page, query.limit); }
  @Post(':id/trades')
  create(@Param('id', new ParseUUIDPipe()) id: string, @Query() owner: PortfolioOwnerDto, @Body() input: PortfolioTradeDto) { return this.pnl.save(owner.userId, id, input); }
  @Patch(':id/trades/:tradeId')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Param('tradeId', new ParseUUIDPipe()) tradeId: string, @Query() owner: PortfolioOwnerDto, @Body() input: PortfolioTradeDto) { return this.pnl.save(owner.userId, id, input, tradeId); }
  @Delete(':id/trades/:tradeId')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Param('tradeId', new ParseUUIDPipe()) tradeId: string, @Query() owner: PortfolioOwnerDto) { return this.pnl.remove(owner.userId, id, tradeId); }
}
