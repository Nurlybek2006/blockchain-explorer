import { Module } from '@nestjs/common';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { WatchlistsController } from './watchlists.controller.js';
import { WatchlistsRepository } from './watchlists.repository.js';
import { WatchlistsService } from './watchlists.service.js';

@Module({ controllers: [WatchlistsController], providers: [InternalServiceGuard, WatchlistsRepository, WatchlistsService] })
export class WatchlistsModule {}
