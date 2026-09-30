import { Module } from '@nestjs/common';
import { RuntimesModule } from '@modules/runtimes/index.js';
import { WorkerOpsModule } from '@modules/worker-ops/index.js';
import { JobsOpsController } from './controllers/jobs-ops.controller.js';
import { JobsOpsService } from './services/jobs-ops.service.js';
import { JobsMetricsService } from './services/jobs-metrics.service.js';
import { JobsMonitorService } from './services/jobs-monitor.service.js';

/** API Jobs cho System Console (`/ops/jobs/*`) + monitor nền (job stalled / chạy lâu). */
@Module({
  imports: [WorkerOpsModule, RuntimesModule],
  controllers: [JobsOpsController],
  providers: [JobsOpsService, JobsMetricsService, JobsMonitorService],
  exports: [JobsOpsService],
})
export class JobsOpsModule {}
