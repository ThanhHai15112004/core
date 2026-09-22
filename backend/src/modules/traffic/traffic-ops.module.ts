import { Module } from '@nestjs/common';
import { TrafficController } from './controllers/traffic.controller.js';
import { TrafficStoreService } from './services/traffic-store.service.js';
import { TrafficService } from './services/traffic.service.js';

/** API đọc HTTP traffic cho System Console (`/ops/traffic/*`). */
@Module({
  controllers: [TrafficController],
  providers: [TrafficStoreService, TrafficService],
  exports: [TrafficService],
})
export class TrafficOpsModule {}
