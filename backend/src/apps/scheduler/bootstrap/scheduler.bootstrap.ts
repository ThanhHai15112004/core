import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { PinoNestLogger } from '@packages/logging/index.js';
import { RuntimeAgentService } from '@packages/runtime/index.js';
import { SchedulerModule } from '../scheduler.module.js';

export async function bootstrapScheduler(): Promise<void> {
  const logger = new Logger('SchedulerBootstrap');
  const app = await NestFactory.createApplicationContext(SchedulerModule, { bufferLogs: true });
  app.useLogger(app.get(PinoNestLogger));
  app.enableShutdownHooks();

  const agent = app.get(RuntimeAgentService);
  agent.installCrashHandlers();

  logger.log('Cron Scheduler started');
}
