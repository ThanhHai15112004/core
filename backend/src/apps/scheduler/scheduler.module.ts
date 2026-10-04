import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import { LoggingModule } from '@packages/logging/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { CacheModule } from '@packages/cache/index.js';
import { StorageModule } from '@packages/storage/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';
import { MetricsModule } from '@packages/metrics/index.js';
import { SchedulerStoreModule } from '@packages/scheduler/index.js';
import { ScheduledTaskRegistry } from './registry/scheduled-task.registry.js';
import { SystemTask } from './tasks/system/system.task.js';
import { HistoryPruneTask } from './tasks/system/history-prune.task.js';
import { TaskRunnerService } from './runner/task-runner.service.js';
import { SchedulerRuntimeContributor } from './runtime/scheduler-runtime.contributor.js';

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'scheduler', kind: 'long-running' }),
    MetricsModule.forRuntime({ runtime: 'scheduler', port: 9102 }),
    ScheduleModule.forRoot(),
    I18nModule,
    LoggingModule.forRoot({ runtime: 'scheduler' }),
    DatabaseModule,
    CacheModule,
    StorageModule,
    MessagingModule,
    SchedulerStoreModule,
  ],
  providers: [
    ScheduledTaskRegistry,
    SystemTask,
    HistoryPruneTask,
    TaskRunnerService,
    SchedulerRuntimeContributor,
  ],
  exports: [ScheduledTaskRegistry, SystemTask],
})
export class SchedulerModule {}
