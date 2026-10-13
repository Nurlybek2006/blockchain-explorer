import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsOwnerDto, PortfolioHistoryQueryDto } from './dto/analytics-query.dto.js';

@Controller('internal/portfolios')
@UseGuards(InternalServiceGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':id/valuation')
  valuation(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: AnalyticsOwnerDto) {
    return this.analytics.valuation(query.userId, id);
  }

  @Get(':id/history')
  history(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioHistoryQueryDto) {
    return this.analytics.history(query.userId, id, query.range, query.limit);
  }

  @Get(':id/analytics')
  summary(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: AnalyticsOwnerDto) {
    return this.analytics.analytics(query.userId, id);
  }
}
