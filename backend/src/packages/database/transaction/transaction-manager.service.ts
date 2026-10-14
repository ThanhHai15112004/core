import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager, QueryRunner } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import type {
  TransactionIsolationLevel,
  TransactionOptions,
  UnitOfWorkContract,
} from './unit-of-work.contract.js';

interface TransactionStore {
  runner: QueryRunner;
  manager: EntityManager;
  depth: number;
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
 */
@Injectable()
export class TransactionManager implements UnitOfWorkContract {
  private readonly logger = new Logger('TransactionManager');
  private readonly storage = new AsyncLocalStorage<TransactionStore>();
  private manualRunner: QueryRunner | null = null;

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly config: CoreConfigService,
  ) {}

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
      if (timedOut) {
        this.logger.warn(`Transaction exceeded ${timeoutMs}ms timeout — rolling back`);
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
