import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { PaginationQueryDto } from '../explorer/dto/pagination-query.dto.js';
import { CreateAlertDto, UpdateAlertDto } from './dto/intelligence.dto.js';
import { IntelligenceClient } from './intelligence.client.js';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly client: IntelligenceClient) {}
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateAlertDto) { return this.client.createAlert(user.id, input); }
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) { return this.client.alerts(user.id, query.page, query.limit); }
  @Get('events')
  events(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) { return this.client.alertEvents(user.id, query.page, query.limit); }
  @Patch('events/:id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.client.markAlertRead(user.id, id); }
  @Get(':id')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.client.alert(user.id, id); }
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: UpdateAlertDto) {
    return this.client.updateAlert(user.id, id, input);
  }
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.client.deleteAlert(user.id, id); }
}
