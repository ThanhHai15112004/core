import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import type { LogEntry, LogSink } from '@packages/logging/index.js';
import { runtimeKeys } from '../constants/runtime.keys.js';
import { RUNTIME_IDENTITY } from '../constants/runtime.tokens.js';
import type { RuntimeIdentity } from '../contracts/runtime.types.js';

const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER = 500;

/** Gom log của runtime theo lô và đẩy vào ring buffer Redis `runtime:logs:<id>`. */
@Injectable()
export class RuntimeLogSink implements LogSink, OnApplicationShutdown {
  private buffer: LogEntry[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(
    @Inject(RUNTIME_IDENTITY) private readonly identity: RuntimeIdentity,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
  ) {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  public write(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
  }

  public async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.redis.isReady()) return;
    const batch = this.buffer;
    this.buffer = [];
    const key = runtimeKeys(this.redis).logs(this.identity.id);
    try {
      await this.redis.client
        .multi()
        .lpush(key, ...batch.map((e) => JSON.stringify(e)))
        .ltrim(key, 0, this.config.runtime.logRetention - 1)
        .exec();
    } catch {
      // Redis lỗi: bỏ lô này thay vì giữ vô hạn trong RAM.
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
