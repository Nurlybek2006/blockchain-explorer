import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeEventsConsumer } from './realtime-events.consumer.js';

@Module({ providers: [RealtimeGateway, RealtimeEventsConsumer], exports: [RealtimeEventsConsumer] })
export class RealtimeModule {}
