import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import { LoggingModule } from '@packages/logging/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';
import { SystemTask } from './tasks/system/system.task.js';
import { TaskRunnerService } from './runner/task-runner.service.js';
import { SchedulerRuntimeContributor } from './runtime/scheduler-runtime.contributor.js';

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'scheduler', kind: 'long-running' }),
    ScheduleModule.forRoot(),
    I18nModule,
    LoggingModule,
    DatabaseModule,
    MessagingModule,
  ],
  providers: [SystemTask, TaskRunnerService, SchedulerRuntimeContributor],
  exports: [SystemTask],
})
export class SchedulerModule {}
