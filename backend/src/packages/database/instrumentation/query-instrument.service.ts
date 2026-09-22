import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource, type QueryRunner } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import {
  MetricRecorder,
  addRequestTiming,
  telemetryKeys,
  type SlowQueryRecord,
} from '@packages/telemetry/index.js';
import { ERROR_LOG_SIZE, databaseKeys } from '../constants/database.keys.js';
import type { DbErrorRecord } from '../contracts/database-events.types.js';
import { recordDbEvent } from '../monitoring/db-events.js';
import { classifyDbError, errorCodeOf, sanitizeDbMessage } from './error-classify.js';
import { normalizeSql } from './sql-normalize.js';
import { readPoolStats } from './pool-stats.js';

const INSTRUMENTED = Symbol('coreQueryInstrumented');

export type DatabaseInstrumentState = 'active' | 'no-datasource';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

/**
 * Đo mọi query đi qua TypeORM (latency, lỗi theo loại, slow query, transaction, pool) mà không phụ thuộc driver:
 * bọc `driver.createQueryRunner` nên query từ repository, query builder và `dataSource.query` đều được đếm.
 * Query của chính System Console (health check, monitoring) chạy trong `untracked()` → không làm sai số liệu của app.
 */
@Injectable()
export class QueryInstrumentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueryInstrumentService.name);
  private readonly untrackedScope = new AsyncLocalStorage<true>();
  private dataSource: DataSource | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: CoreConfigService,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  public get state(): DatabaseInstrumentState {
    return this.dataSource ? 'active' : 'no-datasource';
  }

  public onApplicationBootstrap(): void {
    let dataSource: DataSource | null = null;
    try {
      dataSource = this.moduleRef.get(DataSource, { strict: false });
    } catch {
      dataSource = null;
    }
    if (dataSource) this.attach(dataSource);
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Chạy `fn` mà không tính các query bên trong vào số liệu của app (dùng cho health check/monitoring). */
  public untracked<T>(fn: () => Promise<T>): Promise<T> {
    return this.untrackedScope.run(true, fn);
  }

  /** Gắn đo đạc vào một DataSource (public để test và cho DataSource tạo thủ công). */
  public attach(dataSource: DataSource): void {
    const driver = dataSource.driver as typeof dataSource.driver & { [INSTRUMENTED]?: boolean };
    if (driver[INSTRUMENTED]) return;
    driver[INSTRUMENTED] = true;
    this.dataSource = dataSource;

    const createQueryRunner = driver.createQueryRunner.bind(driver);
    driver.createQueryRunner = (mode) => this.wrap(createQueryRunner(mode));

    this.timer = setInterval(() => this.samplePool(), this.config.performance.flushMs);
    this.timer.unref();
    this.logger.log(`Query instrumentation attached (${dataSource.options.type})`);
  }

  public poolLimit(): number {
    return this.config.database.maxConnections;
  }

  private tracked(): boolean {
    return this.untrackedScope.getStore() !== true;
  }

  private wrap<T extends QueryRunner>(runner: T): T {
    const r = runner as unknown as Record<string, AnyFn>;
    const query = r['query']!.bind(runner);
    r['query'] = async (...args: unknown[]) => {
      if (!this.tracked()) return query(...args);
      const startedAt = performance.now();
      let error: unknown = null;
      try {
        return await query(...args);
      } catch (err) {
        error = err;
        throw err;
      } finally {
        this.observe(String(args[0] ?? ''), performance.now() - startedAt, error !== null, error);
      }
    };

    // Transaction thật của app: số bắt đầu / commit / rollback và thời gian giữ transaction.
    let txStartedAt: number | null = null;
    const wrapTx = (name: string, onDone: (ok: boolean) => void) => {
      const original = r[name]?.bind(runner);
      if (!original) return;
      r[name] = async (...args: unknown[]) => {
        try {
          const result = await original(...args);
          if (this.tracked()) onDone(true);
          return result;
        } catch (err) {
          if (this.tracked()) onDone(false);
          throw err;
        }
      };
    };
    wrapTx('startTransaction', (ok) => {
      if (!ok) return;
      txStartedAt = performance.now();
      this.recorder?.count('db.tx.started');
    });
    const finish = (kind: 'committed' | 'rolledback') => (ok: boolean) => {
      if (!ok) return;
      this.recorder?.count(`db.tx.${kind}`);
      if (txStartedAt !== null)
        this.recorder?.timing('db.tx.duration', performance.now() - txStartedAt);
      txStartedAt = null;
    };
    wrapTx('commitTransaction', finish('committed'));
    wrapTx('rollbackTransaction', finish('rolledback'));
    return runner;
  }

  /** Ghi số đo một query (public để test). */
  public observe(sql: string, ms: number, failed: boolean, error: unknown = null): void {
    this.recorder?.timing('db.query', ms);
    if (ms >= this.config.database.slowQueryMs) this.recorder?.count('db.slow');
    addRequestTiming('db', ms);
    if (failed) {
      this.recorder?.count('db.errors');
      this.recordError(sql, error);
    }
    if (ms >= this.config.performance.dbSlowMs) this.storeSlow(sql, ms, failed);
  }

  private recordError(sql: string, error: unknown): void {
    const kind = classifyDbError(error);
    this.recorder?.count(`db.err.${kind}`);
    if (!this.redis?.isReady()) return;
    const record: DbErrorRecord = {
      at: Date.now(),
      kind,
      code: errorCodeOf(error),
      message: sanitizeDbMessage(error),
      sql: normalizeSql(sql),
      runtime: this.identity?.id ?? null,
      instance: this.recorder?.instance ?? null,
      correlationId: RequestContextService.currentCorrelationId() ?? null,
    };
    const key = databaseKeys(this.redis).errors();
    void this.redis.client
      .multi()
      .lpush(key, JSON.stringify(record))
      .ltrim(key, 0, ERROR_LOG_SIZE - 1)
      .exec()
      .catch(() => undefined);
    if (kind === 'deadlock') {
      void recordDbEvent(this.redis, {
        type: 'deadlock',
        severity: 'warning',
        params: { sql: record.sql.slice(0, 120), correlationId: record.correlationId ?? '' },
        runtime: record.runtime,
      });
    }
  }

  private storeSlow(sql: string, ms: number, failed: boolean): void {
    if (!this.redis?.isReady() || !this.recorder?.enabled) return;
    const record: SlowQueryRecord = {
      at: Date.now(),
      sql: normalizeSql(sql),
      durationMs: Math.round(ms * 10) / 10,
      failed,
      instance: this.recorder.instance ?? 'unknown',
      correlationId: RequestContextService.currentCorrelationId() ?? null,
    };
    const key = telemetryKeys(this.redis).slowQueries();
    void this.redis.client
      .multi()
      .lpush(key, JSON.stringify(record))
      .ltrim(key, 0, this.config.performance.dbSlowLogSize - 1)
      .exec()
      .catch(() => undefined);
  }

  private samplePool(): void {
    if (!this.dataSource?.isInitialized) return;
    const stats = readPoolStats(this.dataSource.driver);
    if (!stats) return;
    this.recorder?.gauge('db.pool.used', stats.used);
    this.recorder?.gauge('db.pool.idle', stats.idle);
    this.recorder?.gauge('db.pool.waiting', stats.waiting);
    this.recorder?.gauge('db.pool.limit', this.poolLimit());
  }
}
