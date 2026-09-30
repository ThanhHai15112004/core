import { Module } from '@nestjs/common';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { TrafficOpsModule } from '@modules/traffic/index.js';
import { RuntimesModule } from '@modules/runtimes/index.js';
import { SchedulerStoreModule } from '@packages/scheduler/index.js';
import { LogsOpsController } from './controllers/logs-ops.controller.js';
import { LogsOpsService } from './services/logs-ops.service.js';
import { LogsStoreService } from './services/logs-store.service.js';
import { LogsMetricsService } from './services/logs-metrics.service.js';
import { LogAuditService } from './services/log-audit.service.js';
import { LogTraceService } from './services/log-trace.service.js';
import { LogsMonitorService } from './services/logs-monitor.service.js';

/** API Logs cho System Console (`/ops/logs/*`) + việc nền (dọn nhóm lỗi, level tạm thời hết hạn). */
@Module({
  imports: [PerformanceOpsModule, TrafficOpsModule, RuntimesModule, SchedulerStoreModule],
  controllers: [LogsOpsController],
  providers: [
    LogsOpsService,
    LogsStoreService,
    LogsMetricsService,
    LogAuditService,
    LogTraceService,
    LogsMonitorService,
  ],
  exports: [LogsOpsService],
})
export class LogsOpsModule {}
