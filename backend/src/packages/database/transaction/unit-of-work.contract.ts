import type { EntityManager } from 'typeorm';

export type TransactionIsolationLevel =
  'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  /** Ghi đè thời gian timeout (ms) cho riêng transaction này; mặc định lấy từ `DB_TRANSACTION_TIMEOUT_MS`. */
  timeoutMs?: number;
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
