import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { PinoNestLogger } from '@packages/logging/index.js';
import { RedisService } from '@packages/redis/index.js';
import { CliHistoryService } from '@packages/runtime/index.js';
import { CliModule } from '../cli.module.js';
import { CliDispatcherService } from '../dispatcher/cli-dispatcher.service.js';

const REDIS_READY_TIMEOUT_MS = 2000;

/** Khởi tạo ngữ cảnh NestJS CLI, cấu hình logger, nạp dispatcher và thực thi lệnh */
export async function bootstrapCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const logger = new Logger('CliBootstrap');
  const app = await NestFactory.createApplicationContext(CliModule, { bufferLogs: true });
  app.useLogger(app.get(PinoNestLogger));
  await app.init();

  const dispatcher = app.get(CliDispatcherService);
  const history = app.get(CliHistoryService);
  const commandName = args[0] ?? 'help';

  // Với các lệnh offline như help, arch:check, module:create, không cần đợi Redis
  const isOfflineFriendly = [
    'help',
    '--help',
    '-h',
    'arch:check',
    'architecture:check',
    'module:create',
    'module:list',
  ].includes(commandName);
  if (!isOfflineFriendly) {
    await waitForRedis(app.get(RedisService));
  }

  try {
    await history.track(commandName, args.slice(1), () => dispatcher.dispatch(args));
  } catch (error) {
    logger.error(`CLI execution failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

/** CLI chạy ngắn: đợi Redis sẵn sàng một chút để lịch sử lệnh được ghi lại nếu Redis khả dụng. */
async function waitForRedis(redis: RedisService): Promise<void> {
  const deadline = Date.now() + REDIS_READY_TIMEOUT_MS;
  while (!redis.isReady() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}
