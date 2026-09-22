import { Module } from '@nestjs/common';
import { KernelModule } from '@packages/kernel/index.js';
import { ConfigModule } from '@packages/config/index.js';
import { LoggingModule } from '@packages/logging/index.js';
import { I18nModule } from '@packages/i18n/index.js';
import { DatabaseModule } from '@packages/database/index.js';
import { MessagingModule } from '@packages/messaging/index.js';
import { RedisModule } from '@packages/redis/index.js';
import { RuntimeAgentModule } from '@packages/runtime/index.js';
import { SystemCommand } from './commands/system/system.command.js';

@Module({
  imports: [
    KernelModule,
    ConfigModule,
    RedisModule,
    RuntimeAgentModule.forRuntime({ id: 'cli', kind: 'on-demand' }),
    I18nModule,
    LoggingModule,
    DatabaseModule,
    MessagingModule,
  ],
  providers: [SystemCommand],
  exports: [SystemCommand],
})
export class CliModule {}
