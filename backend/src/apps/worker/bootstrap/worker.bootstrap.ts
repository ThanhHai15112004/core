import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { CoreLoggerService } from '@packages/logging/index.js';
import { RuntimeAgentService } from '@packages/runtime/index.js';
import { WorkerModule } from '../worker.module.js';

export async function bootstrapWorker(): Promise<void> {
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(CoreLoggerService));
  app.enableShutdownHooks();

  const agent = app.get(RuntimeAgentService);
  agent.attachApp(app);
  agent.installCrashHandlers();

  logger.log('Background Worker started, consuming queue jobs');
}
