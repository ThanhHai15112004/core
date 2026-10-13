import { Module } from '@nestjs/common';
import { TrafficOpsModule } from '@modules/traffic/index.js';
import { RuntimesModule } from '@modules/runtimes/index.js';
import { PerformanceController } from './controllers/performance.controller.js';
import { PerformanceService } from './services/performance.service.js';
import { PerformanceInputsService } from './services/performance-inputs.service.js';
import { PerformanceEventsService } from './services/performance-events.service.js';
import { PerformanceMonitorService } from './services/performance-monitor.service.js';

/** API phân tích hiệu năng cho System Console (`/ops/performance/*`) + monitor ghi sự kiện nghẽn. */
@Module({
  imports: [TrafficOpsModule, RuntimesModule],
  controllers: [PerformanceController],
  providers: [
    PerformanceService,
    PerformanceInputsService,
    PerformanceEventsService,
    PerformanceMonitorService,
  ],
  exports: [PerformanceService],
})
export class PerformanceOpsModule {}
