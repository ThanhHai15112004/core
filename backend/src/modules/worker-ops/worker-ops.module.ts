import { Module } from '@nestjs/common';
import { PerformanceOpsModule } from '@modules/performance/index.js';
import { RuntimesModule } from '@modules/runtimes/index.js';
import { WorkerOpsController } from './controllers/worker-ops.controller.js';
import { QueueOpsController } from './controllers/queue-ops.controller.js';
import { WorkerOpsService } from './services/worker-ops.service.js';
import { WorkerMetricsService } from './services/worker-metrics.service.js';
import { WorkerStoreService } from './services/worker-store.service.js';
import { WorkerMonitorService } from './services/worker-monitor.service.js';

/** API Worker & Queue cho System Console (`/ops/workers/*`, `/ops/queues/*`) + monitor nền (độ sâu & cảnh báo). */
@Module({
  imports: [PerformanceOpsModule, RuntimesModule],
  controllers: [WorkerOpsController, QueueOpsController],
  providers: [WorkerOpsService, WorkerMetricsService, WorkerStoreService, WorkerMonitorService],
  exports: [WorkerOpsService, WorkerMetricsService],
})
export class WorkerOpsModule {}
