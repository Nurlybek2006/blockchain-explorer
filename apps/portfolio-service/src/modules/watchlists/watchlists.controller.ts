import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { PortfolioOwnerDto, PortfolioPaginationDto } from '../portfolios/dto/portfolio.dto.js';
import { CreateWatchlistDto, CreateWatchlistItemDto, UpdateWatchlistDto } from './dto/watchlist.dto.js';
import { WatchlistsService } from './watchlists.service.js';

@Controller('internal/watchlists')
@UseGuards(InternalServiceGuard)
export class WatchlistsController {
  constructor(private readonly watchlists: WatchlistsService) {}

  @Post()
  create(@Body() input: CreateWatchlistDto) { return this.watchlists.create(input.userId, input); }

  @Get()
  list(@Query() query: PortfolioPaginationDto) { return this.watchlists.list(query.userId, query.page, query.limit); }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto) {
    return this.watchlists.detail(query.userId, id);
  }

  @Patch(':id')
  rename(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto, @Body() input: UpdateWatchlistDto) {
    return this.watchlists.rename(query.userId, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto) {
    return this.watchlists.remove(query.userId, id);
  }

  @Post(':id/items')
  addItem(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PortfolioOwnerDto, @Body() input: CreateWatchlistItemDto) {
    return this.watchlists.addItem(query.userId, id, input);
  }

  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Query() query: PortfolioOwnerDto,
  ) { return this.watchlists.removeItem(query.userId, id, itemId); }
}
