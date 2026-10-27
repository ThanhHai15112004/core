import { Module } from '@nestjs/common';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import { LoggingModule } from '@packages/logging/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { QueueModule } from '@packages/queue/index.js';
import { CacheModule } from '@packages/cache/index.js';
import { StorageModule } from '@packages/storage/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';
import { MetricsModule } from '@packages/metrics/index.js';
import { UsersModule } from '@modules/users/index.js';
import { FilesModule } from '@modules/files/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { WorkflowsModule } from '@modules/workflows/index.js';
import { ImportsModule } from '@modules/imports/index.js';
import { ExportsModule } from '@modules/exports/index.js';
import { ReportsModule } from '@modules/reports/index.js';
import { SearchModule } from '@modules/search/index.js';
import { SystemProcessor } from './processors/system/system.processor.js';
import { CriticalProcessor } from './processors/critical/critical.processor.js';
import { NotificationsProcessor } from './processors/notifications/notifications.processor.js';
import { HeavyJobProcessor } from './processors/heavy/heavy-job.processor.js';
import { WorkerRuntimeContributor } from './runtime/worker-runtime.contributor.js';

const PROCESSORS = [SystemProcessor, CriticalProcessor, NotificationsProcessor, HeavyJobProcessor];

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'worker', kind: 'long-running' }),
    MetricsModule.forRuntime({ runtime: 'worker', port: 9101 }),
    I18nModule,
    LoggingModule.forRoot({ runtime: 'worker' }),
    DatabaseModule,
    MessagingModule,
    QueueModule,
    CacheModule,
    StorageModule,
    UsersModule,
    FilesModule,
    NotificationsModule,
    WorkflowsModule,
    ImportsModule,
    ExportsModule,
    ReportsModule,
    SearchModule,
  ],
  providers: [...PROCESSORS, WorkerRuntimeContributor],
  exports: [...PROCESSORS],
})
export class WorkerModule {}
