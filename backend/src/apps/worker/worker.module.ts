import { Module } from '@nestjs/common';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import { LoggingModule } from '@packages/logging/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { CacheModule } from '@packages/cache/index.js';
import { SystemProcessor } from './processors/system/system.processor.js';

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    LoggingModule,
    DatabaseModule,
    MessagingModule,
    CacheModule,
  ],
  providers: [SystemProcessor],
  exports: [SystemProcessor],
})
export class WorkerModule {}
