import { performance } from 'node:perf_hooks';
import {
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
import {
  MetricRecorder,
  addRequestTiming,
  telemetryKeys,
  type SlowQueryRecord,
} from '@packages/telemetry/index.js';
import { normalizeSql } from './sql-normalize.js';
import { readPoolStats } from './pool-stats.js';

const INSTRUMENTED = Symbol('coreQueryInstrumented');

export type DatabaseInstrumentState = 'active' | 'no-datasource';

/**
 * Đo mọi query đi qua TypeORM (latency, lỗi, slow query, pool) mà không phụ thuộc driver:
 * bọc `driver.createQueryRunner` nên query từ repository, query builder và `dataSource.query` đều được đếm.
 * Không có `DataSource` (TypeORM chưa được cấu hình) → trạng thái `no-datasource`, không tạo số liệu.
 */
@Injectable()
export class QueryInstrumentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueryInstrumentService.name);
  private dataSource: DataSource | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: CoreConfigService,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() private readonly redis?: RedisService,
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

  private wrap<T extends QueryRunner>(runner: T): T {
    const query = runner.query.bind(runner) as (...args: unknown[]) => Promise<unknown>;
    (runner as { query: (...args: unknown[]) => Promise<unknown> }).query = async (
      ...args: unknown[]
    ) => {
      const startedAt = performance.now();
      let failed = false;
      try {
        return await query(...args);
      } catch (err) {
        failed = true;
        throw err;
      } finally {
        this.observe(String(args[0] ?? ''), performance.now() - startedAt, failed);
      }
    };
    return runner;
  }

  /** Ghi số đo một query (public để test). */
  public observe(sql: string, ms: number, failed: boolean): void {
    this.recorder?.timing('db.query', ms);
    if (failed) this.recorder?.count('db.errors');
    addRequestTiming('db', ms);
    if (ms >= this.config.performance.dbSlowMs) this.storeSlow(sql, ms, failed);
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
    const stats = readPoolStats(this.dataSource?.driver);
    if (!stats) return;
    this.recorder?.gauge('db.pool.used', stats.used);
    this.recorder?.gauge('db.pool.waiting', stats.waiting);
    this.recorder?.gauge('db.pool.limit', this.poolLimit());
  }
}
