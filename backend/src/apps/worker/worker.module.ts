import { Module } from '@nestjs/common';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import { LoggingModule } from '@packages/logging/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { CacheModule } from '@packages/cache/index.js';
import { StorageModule } from '@packages/storage/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';
import { SystemProcessor } from './processors/system/system.processor.js';
import { QueueConsumerService } from './consumers/queue-consumer.service.js';
import { WorkerRuntimeContributor } from './runtime/worker-runtime.contributor.js';

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'worker', kind: 'long-running' }),
    I18nModule,
    LoggingModule,
    DatabaseModule,
    MessagingModule,
    CacheModule,
    StorageModule,
  ],
  providers: [SystemProcessor, QueueConsumerService, WorkerRuntimeContributor],
  exports: [SystemProcessor],
})
export class WorkerModule {}
