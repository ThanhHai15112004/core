import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  LOGS_OPERATION_LOG_SIZE,
  logsKeys,
  type ErrorGroupMeta,
  type LogEntry,
  type LogIngestState,
  type LogLevelOverrideRecord,
  type LogsOperationRecord,
} from '@packages/logging/index.js';
import { LONG_RUNNING_RUNTIMES, runtimeKeys, type RuntimeId } from '@packages/runtime/index.js';
import { compareNewestFirst, normalizeStoredEntry } from './log-query.js';

/** Runtime có ring buffer log (CLI ghi khi chạy lệnh). */
export const LOG_RUNTIMES: RuntimeId[] = [...LONG_RUNNING_RUNTIMES, 'cli'];
/** Đọc lại buffer tối đa mỗi chừng này ms (nhiều request cùng lúc dùng chung một lần đọc). */
const SNAPSHOT_TTL_MS = 1500;

export interface LogSnapshot {
  at: number;
  /** Mới nhất trước, đã gộp mọi runtime. */
  entries: LogEntry[];
  byRuntime: Map<string, LogEntry[]>;
}

export interface ErrorGroupState {
  meta: ErrorGroupMeta;
  firstSeen: number | null;
  lastSeen: number | null;
  total: number;
  dims: Map<string, number>;
}

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Đọc / ghi dữ liệu Logs trong Redis: buffer log từng runtime, nhóm lỗi, level tạm thời, tình trạng ghi, audit. */
@Injectable()
export class LogsStoreService {
  private snapshot: LogSnapshot | null = null;
  private loading: Promise<LogSnapshot> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
  ) {}

  public get keys() {
    return logsKeys(this.redis);
  }

  public get client() {
    return this.redis.client;
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public get capacity(): number {
    return this.config.runtime.logRetention;
  }

  /** Toàn bộ log đang giữ trong buffer (mọi runtime). */
  public async logs(fresh = false): Promise<LogSnapshot> {
    const now = Date.now();
    if (!fresh && this.snapshot && now - this.snapshot.at < SNAPSHOT_TTL_MS) return this.snapshot;
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<LogSnapshot> {
    const rk = runtimeKeys(this.redis);
    const pipe = this.redis.client.pipeline();
    for (const r of LOG_RUNTIMES) pipe.lrange(rk.logs(r), 0, -1);
    const results = (await pipe.exec()) ?? [];
    const byRuntime = new Map<string, LogEntry[]>();
    const all: LogEntry[] = [];
    results.forEach(([err, raws], i) => {
      const runtime = LOG_RUNTIMES[i]!;
      const list: LogEntry[] = [];
      if (!err && Array.isArray(raws)) {
        for (const raw of raws as string[]) {
          const e = parse<LogEntry>(raw);
          if (!e || typeof e.t !== 'string' || typeof e.message !== 'string') continue;
          list.push(normalizeStoredEntry(e, runtime));
        }
      }
      // Nhiều instance cùng runtime ghi chung một list theo lô — sắp lại cho chắc.
      list.sort(compareNewestFirst);
      byRuntime.set(runtime, list);
      all.push(...list);
    });
    all.sort(compareNewestFirst);
    this.snapshot = { at: Date.now(), entries: all, byRuntime };
    return this.snapshot;
  }

  // ─── Nhóm lỗi ─────────────────────────────────────────────────────────────

  public async groups(fingerprints?: string[]): Promise<ErrorGroupState[]> {
    const k = this.keys;
    const c = this.redis.client;
    const [metas, firsts, lasts, counts, dims] = await Promise.all([
      fingerprints ? c.hmget(k.groupMeta(), ...fingerprints) : c.hvals(k.groupMeta()),
      c.hgetall(k.groupFirst()),
      c.zrange(k.groupLast(), 0, -1, 'WITHSCORES'),
      c.hgetall(k.groupCount()),
      c.hgetall(k.groupDims()),
    ]);
    const last = new Map<string, number>();
    for (let i = 0; i < lasts.length; i += 2) last.set(lasts[i]!, Number(lasts[i + 1]));
    const dimsByFp = new Map<string, Map<string, number>>();
    for (const [f, v] of Object.entries(dims)) {
      const sep = f.indexOf('|');
      const fp = f.slice(0, sep);
      const m = dimsByFp.get(fp) ?? new Map<string, number>();
      m.set(f.slice(sep + 1), Number(v));
      dimsByFp.set(fp, m);
    }
    return metas
      .map((raw) => parse<ErrorGroupMeta>(raw))
      .filter((m): m is ErrorGroupMeta => m !== null)
      .map((meta) => ({
        meta,
        firstSeen: firsts[meta.fingerprint] ? Number(firsts[meta.fingerprint]) : null,
        lastSeen: last.get(meta.fingerprint) ?? null,
        total: Number(counts[meta.fingerprint] ?? 0),
        dims: dimsByFp.get(meta.fingerprint) ?? new Map(),
      }));
  }

  /** Bỏ nhóm lỗi không xuất hiện quá thời gian giữ và nhóm cũ nhất khi vượt số nhóm tối đa. */
  public async pruneGroups(now = Date.now()): Promise<number> {
    const k = this.keys;
    const c = this.redis.client;
    const cutoff = now - this.config.logs.errorGroupRetentionDays * 86_400_000;
    const stale = await c.zrangebyscore(k.groupLast(), '-inf', cutoff);
    const size = await c.zcard(k.groupLast());
    const overflow = size - stale.length - this.config.logs.errorGroupMax;
    const excess =
      overflow > 0 ? await c.zrange(k.groupLast(), stale.length, stale.length + overflow - 1) : [];
    const drop = [...stale, ...excess];
    if (drop.length === 0) return 0;
    const dims = await c.hkeys(k.groupDims());
    const dropSet = new Set(drop);
    const dimFields = dims.filter((f) => dropSet.has(f.slice(0, f.indexOf('|'))));
    const pipe = c.pipeline();
    pipe.zrem(k.groupLast(), ...drop);
    pipe.hdel(k.groupMeta(), ...drop);
    pipe.hdel(k.groupFirst(), ...drop);
    pipe.hdel(k.groupCount(), ...drop);
    if (dimFields.length) pipe.hdel(k.groupDims(), ...dimFields);
    await pipe.exec();
    return drop.length;
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

  /** Bỏ level tạm thời đã hết hạn (runtime tự hết hạn; đây chỉ dọn bản ghi để trang hiện đúng). */
  public async expireOverrides(now = Date.now()): Promise<string[]> {
    const expired = [...(await this.overrides()).values()].filter(
      (o) => o.until !== null && o.until <= now,
    );
    if (expired.length)
      await this.redis.client.hdel(this.keys.level(), ...expired.map((o) => o.runtime));
    return expired.map((o) => o.runtime);
  }

  /** Bỏ tình trạng ghi của instance đã dừng mà không kịp tự xoá. */
  public async pruneIngest(maxAgeMs: number, now = Date.now()): Promise<void> {
    const raw = await this.redis.client.hgetall(this.keys.ingest());
    const stale = Object.entries(raw)
      .filter(([, v]) => (parse<LogIngestState>(v)?.updatedAt ?? 0) < now - maxAgeMs)
      .map(([f]) => f);
    if (stale.length) await this.redis.client.hdel(this.keys.ingest(), ...stale);
  }

  // ─── Audit của chính Logs ─────────────────────────────────────────────────

  public async recordOperation(op: Omit<LogsOperationRecord, 'id'>): Promise<void> {
    if (!this.redis.isReady()) return;
    const key = this.keys.operations();
    await this.redis.client
      .multi()
      .lpush(key, JSON.stringify({ id: randomUUID(), ...op }))
      .ltrim(key, 0, LOGS_OPERATION_LOG_SIZE - 1)
      .exec()
      .catch(() => undefined);
  }
}
