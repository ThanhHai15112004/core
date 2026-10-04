import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '@packages/redis/index.js';
import {
  LOGS_OPERATION_LOG_SIZE,
  LogStreamReader,
  logsKeys,
  type LogEntry,
  type LogIngestState,
  type LogLevelOverrideRecord,
  type LogsOperationRecord,
} from '@packages/logging/index.js';
import { compareNewestFirst } from './log-query.js';

/** Số log gần nhất đọc từ stream cho mỗi lần tìm / tổng hợp (cửa sổ phân tích của trang Logs). */
export const LOG_SCAN_LIMIT = 10_000;
/** Đọc lại stream tối đa mỗi chừng này ms (nhiều request cùng lúc dùng chung một lần đọc). */
const SNAPSHOT_TTL_MS = 1500;

export interface LogSnapshot {
  at: number;
  /** Mới nhất trước, mọi runtime. */
  entries: LogEntry[];
  byRuntime: Map<string, LogEntry[]>;
}

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Đọc / ghi dữ liệu Logs trong Redis: stream log, level tạm thời, tình trạng ghi, audit thao tác. */
@Injectable()
export class LogsStoreService {
  private snapshot: LogSnapshot | null = null;
  private loading: Promise<LogSnapshot> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly stream: LogStreamReader,
  ) {}

  public get keys() {
    return logsKeys(this.redis);
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public get capacity(): number {
    return LOG_SCAN_LIMIT;
  }

  public streamLength(): Promise<number> {
    return this.stream.length();
  }

  /** `LOG_SCAN_LIMIT` log gần nhất (mọi runtime). */
  public async logs(fresh = false): Promise<LogSnapshot> {
    const now = Date.now();
    if (!fresh && this.snapshot && now - this.snapshot.at < SNAPSHOT_TTL_MS) return this.snapshot;
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<LogSnapshot> {
    const entries = (await this.stream.recent(LOG_SCAN_LIMIT)).sort(compareNewestFirst);
    const byRuntime = new Map<string, LogEntry[]>();
    for (const e of entries) {
      const r = e.runtime ?? 'unknown';
      const list = byRuntime.get(r) ?? [];
      list.push(e);
      byRuntime.set(r, list);
    }
    this.snapshot = { at: Date.now(), entries, byRuntime };
    return this.snapshot;
  }

  public get(id: string): Promise<LogEntry | null> {
    return this.stream.get(id);
  }

  // ─── Level / tình trạng ghi log ───────────────────────────────────────────

  public async ingestStates(): Promise<LogIngestState[]> {
    const raw = await this.redis.client.hvals(this.keys.ingest());
    return raw.map((r) => parse<LogIngestState>(r)).filter((s): s is LogIngestState => s !== null);
  }

  public async overrides(): Promise<Map<string, LogLevelOverrideRecord>> {
    const raw = await this.redis.client.hgetall(this.keys.level());
    const out = new Map<string, LogLevelOverrideRecord>();
    for (const [runtime, v] of Object.entries(raw)) {
      const rec = parse<LogLevelOverrideRecord>(v);
      if (rec) out.set(runtime, rec);
    }
    return out;
  }

  public async setOverride(rec: LogLevelOverrideRecord): Promise<void> {
    await this.redis.client.hset(this.keys.level(), rec.runtime, JSON.stringify(rec));
  }

  public async clearOverride(runtime: string): Promise<boolean> {
    return (await this.redis.client.hdel(this.keys.level(), runtime)) > 0;
  }

  public async recordOperation(op: Omit<LogsOperationRecord, 'id'>): Promise<void> {
    const rec: LogsOperationRecord = { id: randomUUID(), ...op };
    await this.redis.client
      .multi()
      .lpush(this.keys.operations(), JSON.stringify(rec))
      .ltrim(this.keys.operations(), 0, LOGS_OPERATION_LOG_SIZE - 1)
      .exec();
  }
}
