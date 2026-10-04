import { Module } from '@nestjs/common';
import { QueueModule } from '@packages/queue/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { SchedulerOpsController } from './controllers/scheduler-ops.controller.js';
import { SchedulerOpsService } from './services/scheduler-ops.service.js';
import { SchedulerOperationsService } from './services/scheduler-operations.service.js';

/** API Scheduler cho System Console (`/ops/scheduler/*`) dựa trên BullMQ Job Scheduler. */
@Module({
  imports: [QueueModule, RedisModule],
  controllers: [SchedulerOpsController],
  providers: [SchedulerOpsService, SchedulerOperationsService],
  exports: [SchedulerOpsService, SchedulerOperationsService],
})
export class SchedulerOpsModule {}
