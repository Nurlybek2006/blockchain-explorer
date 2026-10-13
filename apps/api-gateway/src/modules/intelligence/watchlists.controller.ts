import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { PaginationQueryDto } from '../explorer/dto/pagination-query.dto.js';
import { CreateWatchlistDto, CreateWatchlistItemDto, UpdateWatchlistDto } from './dto/intelligence.dto.js';
import { IntelligenceClient } from './intelligence.client.js';

@Controller('watchlists')
@UseGuards(JwtAuthGuard)
export class WatchlistsController {
  constructor(private readonly client: IntelligenceClient) {}
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateWatchlistDto) { return this.client.createWatchlist(user.id, input); }
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) { return this.client.watchlists(user.id, query.page, query.limit); }
  @Get(':id')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.client.watchlist(user.id, id); }
  @Patch(':id')
  rename(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: UpdateWatchlistDto) {
    return this.client.updateWatchlist(user.id, id, input);
  }
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.client.deleteWatchlist(user.id, id); }
  @Post(':id/items')
  addItem(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: CreateWatchlistItemDto) {
    return this.client.addWatchlistItem(user.id, id, input);
  }
  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Param('itemId', new ParseUUIDPipe()) itemId: string) {
    return this.client.deleteWatchlistItem(user.id, id, itemId);
  }
}
