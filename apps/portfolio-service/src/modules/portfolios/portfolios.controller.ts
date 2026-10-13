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
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { CreatePortfolioDto, PortfolioOwnerDto, PortfolioPaginationDto, UpdatePortfolioDto } from './dto/portfolio.dto.js';
import { PortfoliosService } from './portfolios.service.js';

@Controller('internal/portfolios')
@UseGuards(InternalServiceGuard)
export class PortfoliosController {
  constructor(private readonly portfolios: PortfoliosService) {}

  @Post()
  create(@Body() input: CreatePortfolioDto) {
    return this.portfolios.create(input.userId, input);
  }

  @Get()
  list(@Query() query: PortfolioPaginationDto) {
    return this.portfolios.list(query.userId, query.page, query.limit);
  }

  @Get(':id/holdings')
  holdings(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto) {
    return this.portfolios.holdings(query.userId, id);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto) {
    return this.portfolios.detail(query.userId, id);
  }

  @Patch(':id')
  rename(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PortfolioOwnerDto,
    @Body() input: UpdatePortfolioDto,
  ) {
    return this.portfolios.rename(query.userId, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto) {
    return this.portfolios.archive(query.userId, id);
  }
}
