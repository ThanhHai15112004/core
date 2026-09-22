import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { CoreLoggerService } from '@packages/logging/index.js';
import { RedisService } from '@packages/redis/index.js';
import { CliHistoryService } from '@packages/runtime/index.js';
import { CliModule } from '../cli.module.js';
import { SystemCommand } from '../commands/system/system.command.js';

const REDIS_READY_TIMEOUT_MS = 3000;

export async function bootstrapCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const logger = new Logger('CliBootstrap');
  const app = await NestFactory.createApplicationContext(CliModule, { bufferLogs: true });
  app.useLogger(app.get(CoreLoggerService));

  const command = app.get(SystemCommand);
  const history = app.get(CliHistoryService);
  await waitForRedis(app.get(RedisService));

  try {
    await history.track(command.commandName(args), args.slice(1), () => command.execute(args));
  } catch (error) {
    logger.error('CLI Command execution failed:', error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

/** CLI chạy ngắn: đợi Redis sẵn sàng một chút để lịch sử lệnh được ghi lại. */
async function waitForRedis(redis: RedisService): Promise<void> {
  const deadline = Date.now() + REDIS_READY_TIMEOUT_MS;
  while (!redis.isReady() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}
