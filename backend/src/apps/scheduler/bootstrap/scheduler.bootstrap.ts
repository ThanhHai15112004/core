import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SchedulerModule } from '../scheduler.module.js';

export async function bootstrapScheduler(): Promise<void> {
  const logger = new Logger('SchedulerBootstrap');
  const app = await NestFactory.createApplicationContext(SchedulerModule);
  app.enableShutdownHooks();

  logger.log('Cron Scheduler initialized and active.');
}
