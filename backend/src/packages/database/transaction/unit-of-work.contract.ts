import type { EntityManager } from 'typeorm';

export type TransactionIsolationLevel =
  'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionRetryOptions {
  /** Số lần retry tối đa cho lỗi tạm thời (deadlock / lock_timeout), luôn chặn trần ở `DB_MAX_RETRIES_CAP`. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  /** Ghi đè thời gian timeout (ms) cho riêng transaction này; mặc định lấy từ `DB_TRANSACTION_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * Bật retry tự động khi gặp lỗi DB tạm thời (`deadlock`, `lock_timeout`) cho transaction gốc.
   * Truyền `true` để dùng cấu hình mặc định (Settings/.env) hoặc object để tùy chỉnh cục bộ.
   */
  retry?: boolean | TransactionRetryOptions;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface UnitOfWorkContract {
  startTransaction(isolationLevel?: TransactionIsolationLevel): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  getCurrentManager(): EntityManager | null;
  runInTransaction<T>(
    operation: (manager: EntityManager) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
}
