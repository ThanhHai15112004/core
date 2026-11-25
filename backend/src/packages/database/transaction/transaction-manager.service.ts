import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { EntityManager, QueryRunner } from 'typeorm';
import type { Counter } from 'prom-client';
import { CoreConfigService } from '@packages/config/index.js';
import {
  RESILIENCE_SETTING_KEYS,
  readDynamicResilienceBoolean,
  readDynamicResilienceNumber,
} from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import {
  DB_MAX_RETRIES_CAP,
  classifyDbError,
  withDbRetry,
} from '../utils/error-classify.js';
import type {
  TransactionIsolationLevel,
  TransactionOptions,
  TransactionRetryOptions,
  UnitOfWorkContract,
} from './unit-of-work.contract.js';

interface TransactionStore {
  runner: QueryRunner;
  manager: EntityManager;
  depth: number;
}

export interface DbResilienceStatsSnapshot {
  readonly timeoutCount: number;
  readonly retryCount: number;
  readonly retryRecoveredCount: number;
  readonly retryExhaustedCount: number;
  readonly lastTimeoutAt: string | null;
  readonly lastRetryAt: string | null;
}

/** Lỗi ném ra khi giao dịch vượt quá thời gian thực thi tối đa (`DB_TRANSACTION_TIMEOUT_MS`). */
export class TransactionTimeoutError extends Error {
  public readonly code = 'ER_TRANSACTION_TIMEOUT';

  constructor(public readonly timeoutMs: number) {
    super(`Transaction timed out after ${timeoutMs}ms and was automatically rolled back`);
    this.name = 'TransactionTimeoutError';
  }
}

/**
 * Quản lý giao dịch cơ sở dữ liệu (Unit of Work & Transaction Manager):
 * - Tự động truyền `EntityManager` theo ngữ cảnh qua `AsyncLocalStorage`.
 * - Hỗ trợ giao dịch lồng nhau (Nested Transaction) qua `SAVEPOINT`.
 * - Tự động hủy và `rollbackTransaction()` khi vượt ngưỡng `transactionTimeoutMs`.
 * - Hỗ trợ retry giới hạn kèm backoff + jitter cho lỗi tạm thời (`deadlock`, `lock_timeout`) và ghi Prometheus metrics.
 */
@Injectable()
export class TransactionManager implements UnitOfWorkContract {
  private readonly logger = new Logger('TransactionManager');
  private readonly storage = new AsyncLocalStorage<TransactionStore>();
  private manualRunner: QueryRunner | null = null;
  private readonly timeoutsCounter: Counter<'kind'> | null;
  private readonly retriesCounter: Counter<'reason' | 'outcome'> | null;
  private timeoutCount = 0;
  private retryCount = 0;
  private retryRecoveredCount = 0;
  private retryExhaustedCount = 0;
  private lastTimeoutAt: string | null = null;
  private lastRetryAt: string | null = null;

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly config: CoreConfigService,
    @Optional() metrics?: MetricsRegistryService,
  ) {
    if (metrics) {
      this.timeoutsCounter = metrics.counter(
        'core_db_timeouts_total',
        'Total database query, lock, and transaction timeouts',
        ['kind'],
      );
      this.retriesCounter = metrics.counter(
        'core_db_retries_total',
        'Total database transient error retries by reason and outcome',
        ['reason', 'outcome'],
      );
    } else {
      this.timeoutsCounter = null;
      this.retriesCounter = null;
    }
  }

  /** Ảnh chụp chỉ số timeout và retry của tầng Database cho System Console. */
  public getResilienceStats(): DbResilienceStatsSnapshot {
    return {
      timeoutCount: this.timeoutCount,
      retryCount: this.retryCount,
      retryRecoveredCount: this.retryRecoveredCount,
      retryExhaustedCount: this.retryExhaustedCount,
      lastTimeoutAt: this.lastTimeoutAt,
      lastRetryAt: this.lastRetryAt,
    };
  }

  /** Ghi nhận sự kiện timeout từ tầng query/transaction (dùng chung với TypeOrmConfigService). */
  public recordTimeout(kind: 'query' | 'transaction' | 'lock_timeout'): void {
    this.timeoutCount += 1;
    this.lastTimeoutAt = new Date().toISOString();
    this.timeoutsCounter?.inc({ kind });
  }

  /** Phân giải cấu hình retry DB hiện hành (Settings động -> `.env` -> override cục bộ). */
  public resolveRetryConfig(override?: TransactionRetryOptions): {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitter: boolean;
  } {
    const envRetry = this.config.database.retry;
    const baseMax = readDynamicResilienceNumber(
      RESILIENCE_SETTING_KEYS.DB_RETRY_MAX,
      envRetry.maxRetries,
      { min: 0, max: DB_MAX_RETRIES_CAP, round: true },
    );
    const baseDelay = readDynamicResilienceNumber(
      RESILIENCE_SETTING_KEYS.DB_RETRY_BASE_DELAY_MS,
      envRetry.baseDelayMs,
      { min: 10, max: 10_000, round: true },
    );
    const maxDelay = readDynamicResilienceNumber(
      RESILIENCE_SETTING_KEYS.DB_RETRY_MAX_DELAY_MS,
      envRetry.maxDelayMs,
      { min: 50, max: 30_000, round: true },
    );
    const jitter = readDynamicResilienceBoolean(
      RESILIENCE_SETTING_KEYS.DB_RETRY_JITTER,
      envRetry.jitter,
    );

    return {
      maxRetries: Math.min(
        DB_MAX_RETRIES_CAP,
        Math.max(0, Math.floor(override?.maxRetries ?? baseMax)),
      ),
      baseDelayMs: Math.max(10, Math.floor(override?.baseDelayMs ?? baseDelay)),
      maxDelayMs: Math.max(50, Math.floor(override?.maxDelayMs ?? maxDelay)),
      jitter: override?.jitter ?? jitter,
    };
  }

  /** Lấy `EntityManager` của giao dịch hiện tại (nếu đang ở trong `runInTransaction` hoặc `startTransaction`). */
  public getCurrentManager(): EntityManager | null {
    return this.storage.getStore()?.manager ?? this.manualRunner?.manager ?? null;
  }

  /** Kiểm tra ngữ cảnh thực thi hiện tại có đang nằm trong một giao dịch đang mở hay không. */
  public isInTransaction(): boolean {
    return this.getCurrentManager() !== null;
  }

  /** Khởi tạo giao dịch thủ công (dành cho luồng gọi tuần tự `startTransaction` -> `commit` / `rollback`). */
  public async startTransaction(isolationLevel?: TransactionIsolationLevel): Promise<void> {
    if (this.manualRunner) {
      throw new Error('A manual transaction is already active on this TransactionManager instance');
    }
    const ds = this.connection.connected();
    if (!ds) {
      throw new Error(`Database is not connected (state: ${this.connection.getStatus().state})`);
    }
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction(isolationLevel);
    this.manualRunner = runner;
  }

  /** Xác nhận (commit) và giải phóng giao dịch thủ công đang mở. */
  public async commit(): Promise<void> {
    const runner = this.manualRunner;
    if (!runner) {
      throw new Error('No active manual transaction to commit');
    }
    this.manualRunner = null;
    try {
      await runner.commitTransaction();
    } finally {
      await runner.release().catch(() => undefined);
    }
  }

  /** Hoàn tác (rollback) và giải phóng giao dịch thủ công đang mở. */
  public async rollback(): Promise<void> {
    const runner = this.manualRunner;
    if (!runner) {
      throw new Error('No active manual transaction to rollback');
    }
    this.manualRunner = null;
    try {
      await runner.rollbackTransaction();
    } finally {
      await runner.release().catch(() => undefined);
    }
  }

  /**
   * Thực thi hàm `operation` bên trong một giao dịch an toàn có kiểm soát thời gian (timeout).
   * - Nếu đã ở trong một giao dịch (`AsyncLocalStorage`), tự động dùng `SAVEPOINT` cho giao dịch con.
   * - Nếu vượt quá `timeoutMs`, tự động rollback và giải phóng connection về pool.
   */
  public async runInTransaction<T>(
    operation: (manager: EntityManager) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const existing = this.storage.getStore();
    if (existing) {
      return this.runNestedSavepoint(existing, operation, options);
    }

    if (options?.retry) {
      const retryCfg = this.resolveRetryConfig(
        typeof options.retry === 'object' ? options.retry : undefined,
      );
      let retried = false;
      let lastRetryReason = 'deadlock';
      try {
        const result = await withDbRetry(
          () => this.executeSingleTransaction(operation, options),
          {
            ...retryCfg,
            onRetry: ({ attempt, delayMs, kind }) => {
              retried = true;
              lastRetryReason = kind;
              this.retryCount += 1;
              this.lastRetryAt = new Date().toISOString();
              this.retriesCounter?.inc({ reason: kind, outcome: 'scheduled' });
              this.logger.warn(
                `Retrying database transaction (attempt=${attempt}, reason=${kind}, delayMs=${delayMs})`,
              );
            },
          },
        );
        if (retried) {
          this.retryRecoveredCount += 1;
          this.retriesCounter?.inc({ reason: lastRetryReason, outcome: 'recovered' });
        }
        return result;
      } catch (err) {
        if (retried) {
          this.retryExhaustedCount += 1;
          this.retriesCounter?.inc({ reason: classifyDbError(err), outcome: 'exhausted' });
        }
        throw err;
      }
    }

    return this.executeSingleTransaction(operation, options);
  }

  private async executeSingleTransaction<T>(
    operation: (manager: EntityManager) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const ds = this.connection.connected();
    if (!ds) {
      throw new Error(`Database is not connected (state: ${this.connection.getStatus().state})`);
    }

    const timeoutMs = Math.floor(
      options?.timeoutMs ?? this.config.database.transactionTimeoutMs ?? 0,
    );
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction(options?.isolationLevel);

    if (timeoutMs > 0) {
      await this.applySessionTimeout(runner, timeoutMs);
    }

    const store: TransactionStore = {
      runner,
      manager: runner.manager,
      depth: 1,
    };

    let timeoutId: NodeJS.Timeout | null = null;
    let timedOut = false;

    try {
      const execPromise = this.storage.run(store, () => operation(runner.manager));
      const result =
        timeoutMs > 0
          ? await Promise.race([
              execPromise,
              new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                  timedOut = true;
                  reject(new TransactionTimeoutError(timeoutMs));
                }, timeoutMs);
                timeoutId.unref();
              }),
            ])
          : await execPromise;

      await runner.commitTransaction();
      return result;
    } catch (err) {
      if (timedOut || err instanceof TransactionTimeoutError) {
        this.recordTimeout('transaction');
        this.logger.warn(`Transaction exceeded ${timeoutMs}ms timeout — rolling back`);
      } else {
        const kind = classifyDbError(err);
        if (kind === 'lock_timeout' || kind === 'timeout') {
          this.recordTimeout(kind === 'lock_timeout' ? 'lock_timeout' : 'query');
        }
      }
      await runner.rollbackTransaction().catch(() => undefined);
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      await runner.release().catch(() => undefined);
    }
  }

  /** Thực thi giao dịch lồng nhau bằng cơ chế SAVEPOINT trên cùng QueryRunner. */
  private async runNestedSavepoint<T>(
    parent: TransactionStore,
    operation: (manager: EntityManager) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const nextDepth = parent.depth + 1;
    const savepoint = `sp_core_${nextDepth}`;
    const nestedStore: TransactionStore = {
      runner: parent.runner,
      manager: parent.manager,
      depth: nextDepth,
    };

    await parent.runner.query(`SAVEPOINT ${savepoint}`);
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutMs = Math.floor(options?.timeoutMs ?? 0);

    try {
      const execPromise = this.storage.run(nestedStore, () => operation(parent.manager));
      const result =
        timeoutMs > 0
          ? await Promise.race([
              execPromise,
              new Promise<never>((_, reject) => {
                timeoutId = setTimeout(
                  () => reject(new TransactionTimeoutError(timeoutMs)),
                  timeoutMs,
                );
                timeoutId.unref();
              }),
            ])
          : await execPromise;

      await parent.runner.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
      return result;
    } catch (err) {
      await parent.runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /** Thiết lập timeout cấp phiên của Database Server cho giao dịch hiện tại (best-effort). */
  private async applySessionTimeout(runner: QueryRunner, timeoutMs: number): Promise<void> {
    const driver = this.connection.driver;
    if (driver === 'postgres') {
      await runner
        .query(`SET LOCAL idle_in_transaction_session_timeout = ${timeoutMs}`)
        .catch(() => undefined);
      await runner.query(`SET LOCAL statement_timeout = ${timeoutMs}`).catch(() => undefined);
    } else if (driver === 'mysql' || driver === 'mariadb') {
      const sec = Math.max(1, Math.ceil(timeoutMs / 1000));
      await runner.query(`SET SESSION innodb_lock_wait_timeout = ${sec}`).catch(() => undefined);
    }
  }
}
