export interface UnitOfWorkContract {
  startTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  runInTransaction<T>(operation: () => Promise<T>): Promise<T>;
}
