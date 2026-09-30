import { Module } from '@nestjs/common';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { SchedulerStoreModule } from '@packages/scheduler/index.js';
import { SchedulerOpsController } from './controllers/scheduler-ops.controller.js';
import { SchedulerOpsService } from './services/scheduler-ops.service.js';
import { SchedulerOperationsService } from './services/scheduler-operations.service.js';
import { SchedulerMetricsService } from './services/scheduler-metrics.service.js';
import { SchedulerMonitorService } from './services/scheduler-monitor.service.js';

/** API Scheduler cho System Console (`/ops/scheduler/*`) + monitor nền (cảnh báo, lần chạy mồ côi). */
@Module({
  imports: [PerformanceOpsModule, SchedulerStoreModule],
  controllers: [SchedulerOpsController],
  providers: [
    SchedulerOpsService,
    SchedulerOperationsService,
    SchedulerMetricsService,
    SchedulerMonitorService,
  ],
  exports: [SchedulerOpsService],
})
export class SchedulerOpsModule {}
