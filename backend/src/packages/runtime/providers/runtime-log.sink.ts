import { Inject, Injectable, Optional, type OnApplicationShutdown } from '@nestjs/common';
import * as os from 'node:os';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  LOG_METRIC,
  LOG_METRIC_CARDINALITY,
  fingerprintOf,
  logsKeys,
  topFrame,
  type ErrorGroupMeta,
  type LogEntry,
  type LogSink,
} from '@packages/logging/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { runtimeKeys } from '../constants/runtime.keys.js';
import { RUNTIME_IDENTITY } from '../constants/runtime.tokens.js';
import type { RuntimeIdentity } from '../contracts/runtime.types.js';

const FLUSH_INTERVAL_MS = 1000;
/** Log chờ ghi tối đa khi kho log chậm / mất kết nối — vượt thì bỏ log cũ nhất và đếm là "dropped". */
const MAX_BUFFER = 2000;

/** Tên metric an toàn: không chứa dấu phân cách field của telemetry. */
const metricName = (s: string) => s.replace(/[^\w.:-]/g, '_').slice(0, 80);

interface GroupBatch {
  count: number;
  first: number;
  last: LogEntry;
  dims: Map<string, number>;
}

/**
 * Gom log của runtime theo lô và đẩy vào ring buffer Redis `runtime:logs:<id>`; cập nhật nhóm lỗi (fingerprint) và
 * số đo volume (log/phút theo level, byte, log mất) vào telemetry. Không bao giờ giữ log vô hạn trong RAM.
 */
@Injectable()
export class RuntimeLogSink implements LogSink, OnApplicationShutdown {
  private buffer: LogEntry[] = [];
  private readonly timer: NodeJS.Timeout;
  private readonly instance = `${os.hostname()}:${process.pid}`;
  private readonly seenGroups = new Set<string>();
  private readonly seenModules = new Set<string>();
  private flushing = false;
  public dropped = 0;
  public lastSuccessAt: number | null = null;
  public lastErrorAt: number | null = null;
  public lastError: string | null = null;

  constructor(
    @Inject(RUNTIME_IDENTITY) private readonly identity: RuntimeIdentity,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
    @Optional() private readonly metrics?: MetricRecorder,
  ) {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  public get instanceName(): string {
    return this.instance;
  }

  public write(entry: LogEntry): void {
    const e: LogEntry = { ...entry, runtime: this.identity.id, instance: this.instance };
    this.buffer.push(e);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.shift();
      this.drop(1);
    }
    this.measure(e);
  }

  private measure(e: LogEntry): void {
    const m = this.metrics;
    if (!m?.enabled) return;
    const at = Date.parse(e.t);
    m.count(LOG_METRIC.level(e.level), 1, at);
    m.count(LOG_METRIC.bytes, e.message.length + (e.stack?.length ?? 0) + 200, at);
    if (e.correlationId || e.requestId || e.jobId || e.messageId || e.executionId)
      m.count(LOG_METRIC.traceable, 1, at);
    const ctx = this.cap(
      this.seenModules,
      metricName(e.context ?? '_none'),
      LOG_METRIC.moduleOther,
    );
    m.count(LOG_METRIC.module(ctx), 1, at);
    if (e.level === 'error' || e.level === 'fatal') m.count(LOG_METRIC.moduleErrors(ctx), 1, at);
    if (e.fingerprint) {
      const fp = this.cap(this.seenGroups, e.fingerprint, '_other');
      m.count(fp === '_other' ? LOG_METRIC.groupOther : LOG_METRIC.group(fp), 1, at);
    }
  }

  private cap(seen: Set<string>, value: string, other: string): string {
    if (seen.has(value)) return value;
    if (seen.size >= LOG_METRIC_CARDINALITY) return other;
    seen.add(value);
    return value;
  }

  private drop(n: number): void {
    this.dropped += n;
    this.metrics?.count(LOG_METRIC.dropped, n);
  }

  public async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    if (!this.redis.isReady()) {
      // Buffer vẫn giữ (tối đa MAX_BUFFER) — ghi khi Redis quay lại.
      return;
    }
    this.flushing = true;
    const batch = this.buffer;
    this.buffer = [];
    const key = runtimeKeys(this.redis).logs(this.identity.id);
    try {
      const pipe = this.redis.client
        .multi()
        .lpush(key, ...batch.map((e) => JSON.stringify(e)))
        .ltrim(key, 0, this.config.runtime.logRetention - 1);
      this.groups(pipe, batch);
      await pipe.exec();
      this.lastSuccessAt = Date.now();
    } catch (err) {
      // Kho log lỗi: bỏ lô này (đếm "dropped") thay vì giữ vô hạn trong RAM.
      this.drop(batch.length);
      this.lastErrorAt = Date.now();
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.flushing = false;
    }
  }

  /** Nhóm lỗi: lần đầu / lần cuối / số lần / mẫu gần nhất / runtime, loại job, endpoint bị ảnh hưởng. */
  private groups(pipe: ReturnType<RedisService['client']['multi']>, batch: LogEntry[]): void {
    const byFp = new Map<string, GroupBatch>();
    for (const e of batch) {
      if (!e.fingerprint) continue;
      const at = Date.parse(e.t);
      const g = byFp.get(e.fingerprint) ?? { count: 0, first: at, last: e, dims: new Map() };
      g.count++;
      g.first = Math.min(g.first, at);
      g.last = e;
      const dims: [string, string | undefined][] = [
        ['rt', e.runtime],
        ['job', e.jobType],
        ['route', e.route],
      ];
      for (const [d, v] of dims) if (v) g.dims.set(`${d}|${v}`, (g.dims.get(`${d}|${v}`) ?? 0) + 1);
      byFp.set(e.fingerprint, g);
    }
    if (byFp.size === 0) return;
    const k = logsKeys(this.redis);
    for (const [fp, g] of byFp) {
      const e = g.last;
      const { template } = fingerprintOf({
        errorType: e.errorType,
        context: e.context,
        message: e.message,
      });
      const meta: ErrorGroupMeta = {
        fingerprint: fp,
        errorType: e.errorType ?? null,
        template,
        context: e.context ?? null,
        frame: topFrame(e.stack) ?? null,
        level: e.level,
        sample: {
          id: e.id ?? null,
          at: Date.parse(e.t),
          message: e.message.slice(0, 1000),
          runtime: e.runtime ?? null,
          instance: e.instance ?? null,
          correlationId: e.correlationId ?? null,
          requestId: e.requestId ?? null,
          jobId: e.jobId ?? null,
          jobType: e.jobType ?? null,
          route: e.route ?? null,
        },
      };
      pipe.hsetnx(k.groupFirst(), fp, String(g.first));
      pipe.hincrby(k.groupCount(), fp, g.count);
      pipe.zadd(k.groupLast(), meta.sample.at, fp);
      pipe.hset(k.groupMeta(), fp, JSON.stringify(meta));
      for (const [dim, n] of g.dims) pipe.hincrby(k.groupDims(), `${fp}|${dim}`, n);
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
