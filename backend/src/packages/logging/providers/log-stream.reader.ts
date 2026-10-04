import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { logsKeys } from '../constants/logs.keys.js';
import type { LogEntry } from '../contracts/log-entry.types.js';
import { toLogEntry } from '../utils/log-entry.js';

type StreamRow = [id: string, fields: string[]];

const toEntries = (rows: StreamRow[]): LogEntry[] =>
  rows
    .map(([id, fields]) => {
      const i = fields.indexOf('d');
      return i >= 0 ? toLogEntry(id, fields[i + 1] ?? '') : null;
    })
    .filter((e): e is LogEntry => e !== null);

/** Đọc log từ Redis Stream `logs:<env>` (XREVRANGE / XRANGE) — dùng cho trang Logs và Runtimes. */
@Injectable()
export class LogStreamReader {
  constructor(
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
  ) {}

  public get key(): string {
    return logsKeys(this.redis).stream(this.config.app.env);
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** `count` log mới nhất (mới nhất trước). */
  public async recent(count: number): Promise<LogEntry[]> {
    const rows = (await this.redis.client.xrevrange(
      this.key,
      '+',
      '-',
      'COUNT',
      count,
    )) as StreamRow[];
    return toEntries(rows);
  }

  public async get(id: string): Promise<LogEntry | null> {
    const rows = (await this.redis.client.xrange(this.key, id, id)) as StreamRow[];
    return toEntries(rows)[0] ?? null;
  }

  public async length(): Promise<number> {
    return this.redis.client.xlen(this.key);
  }
}
