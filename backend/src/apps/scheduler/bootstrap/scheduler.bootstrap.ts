import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { PinoNestLogger } from '@packages/logging/index.js';
import { RuntimeAgentService, installGracefulShutdown } from '@packages/runtime/index.js';
import { SchedulerModule } from '../scheduler.module.js';

/** Khởi tạo ApplicationContext và khởi chạy BullMQ Scheduler runtime */
export async function bootstrapScheduler(): Promise<void> {
  const logger = new Logger('SchedulerBootstrap');
  const app = await NestFactory.createApplicationContext(SchedulerModule, { bufferLogs: true });
  app.useLogger(app.get(PinoNestLogger));

  const configService = app.get(CoreConfigService);
  const agent = app.get(RuntimeAgentService);
  agent.installCrashHandlers();

  if (!configService.isTest) {
    installGracefulShutdown({
      app,
      agent,
      logger,
      drainDelayMs: 0,
      gracefulTimeoutMs: configService.runtime.gracefulTimeoutMs,
    });
  } else {
    app.enableShutdownHooks();
  }

  logger.log('Cron Scheduler started');
}
