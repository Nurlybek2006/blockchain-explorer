import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { PaginationQueryDto } from '../explorer/dto/pagination-query.dto.js';
import { CreatePortfolioDto } from './dto/create-portfolio.dto.js';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto.js';
import { PortfolioService } from './portfolio.service.js';
import { IntelligenceClient } from '../intelligence/intelligence.client.js';
import { PortfolioHistoryQueryDto } from '../intelligence/dto/intelligence.dto.js';

@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService, private readonly intelligence: IntelligenceClient) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreatePortfolioDto) {
    return this.portfolio.create(user.id, input);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.portfolio.list(user.id, query.page, query.limit);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.portfolio.detail(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePortfolioDto,
  ) {
    return this.portfolio.update(user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.portfolio.remove(user.id, id);
  }

  @Get(':id/holdings')
  holdings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.portfolio.holdings(user.id, id);
  }

  @Get(':id/history')
  history(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioHistoryQueryDto) {
    return this.intelligence.history(user.id, id, query.range, query.limit);
  }

  @Get(':id/analytics')
  analytics(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.intelligence.analytics(user.id, id);
  }

  @Get(':id/valuation')
  valuation(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.intelligence.valuation(user.id, id);
  }
}
