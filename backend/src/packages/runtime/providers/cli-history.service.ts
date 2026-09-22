import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '@packages/redis/index.js';
import { runtimeKeys } from '../constants/runtime.keys.js';
import { RUNTIME_IDENTITY } from '../constants/runtime.tokens.js';
import type { CliExecution, RuntimeIdentity } from '../contracts/runtime.types.js';

const HISTORY_LIMIT = 200;

/** Ghi lịch sử mỗi lần chạy CLI (runtime on-demand, không có heartbeat). */
@Injectable()
export class CliHistoryService {
  constructor(
    @Inject(RUNTIME_IDENTITY) private readonly identity: RuntimeIdentity,
    private readonly redis: RedisService,
  ) {}

  /** Chạy `task`, đo thời gian và lưu kết quả; lỗi vẫn được ném lại cho caller. */
  public async track<T>(command: string, args: string[], task: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await task();
      await this.save({ command, args, startedAt, exitCode: 0 });
      return result;
    } catch (error) {
      await this.save({
        command,
        args,
        startedAt,
        exitCode: 1,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async save(input: {
    command: string;
    args: string[];
    startedAt: Date;
    exitCode: number;
    error?: string;
  }) {
    if (this.identity.kind !== 'on-demand') return;
    const entry: CliExecution = {
      id: randomUUID(),
      command: input.command,
      args: input.args,
      startedAt: input.startedAt.toISOString(),
      durationMs: Date.now() - input.startedAt.getTime(),
      exitCode: input.exitCode,
      result: input.exitCode === 0 ? 'success' : 'failure',
      ...(input.error ? { error: input.error } : {}),
    };
    const key = runtimeKeys(this.redis).cliHistory();
    try {
      await this.redis.client
        .multi()
        .lpush(key, JSON.stringify(entry))
        .ltrim(key, 0, HISTORY_LIMIT - 1)
        .exec();
    } catch {
      // Redis không sẵn sàng: bỏ qua, CLI vẫn chạy bình thường.
    }
  }
}
