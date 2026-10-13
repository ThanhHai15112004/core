import { Module } from '@nestjs/common';
import { TrafficController } from './controllers/traffic.controller.js';
import { TrafficService } from './services/traffic.service.js';

/** API đọc HTTP traffic cho System Console (`/ops/traffic/*`). */
@Module({
  controllers: [TrafficController],
  providers: [TrafficService],
  exports: [TrafficService],
})
export class TrafficOpsModule {}
