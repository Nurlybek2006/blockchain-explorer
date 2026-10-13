import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { PortfolioOwnerDto, PortfolioPaginationDto } from '../portfolios/dto/portfolio.dto.js';
import { AlertsService } from './alerts.service.js';
import { CreateAlertDto, UpdateAlertDto } from './dto/alert.dto.js';

@Controller('internal/alerts')
@UseGuards(InternalServiceGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post()
  create(@Body() input: CreateAlertDto) { return this.alerts.create(input.userId, input); }

  @Get()
  list(@Query() query: PortfolioPaginationDto) { return this.alerts.list(query.userId, query.page, query.limit); }

  @Get('events')
  events(@Query() query: PortfolioPaginationDto) { return this.alerts.events(query.userId, query.page, query.limit); }

  @Patch('events/:id/read')
  markRead(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto) {
    return this.alerts.markRead(query.userId, id);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto) { return this.alerts.detail(query.userId, id); }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto, @Body() input: UpdateAlertDto) {
    return this.alerts.update(query.userId, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto) { return this.alerts.remove(query.userId, id); }
}
