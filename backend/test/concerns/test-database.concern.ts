import type { DataSource, EntityManager, QueryRunner } from 'typeorm';

/**
 * Lỗi an toàn cơ sở dữ liệu kiểm thử — ném ra khi phát hiện cấu hình test trỏ vào DB môi trường thật.
 */
export class TestDatabaseSafetyError extends Error {
  public readonly code = 'TEST_DATABASE_SAFETY_VIOLATION';

  constructor(message: string) {
    super(`[TestDatabaseSafetyError] ${message}`);
    this.name = 'TestDatabaseSafetyError';
  }
}

/**
 * Kiểm tra tên cơ sở dữ liệu có hợp lệ để chạy kiểm thử phá hủy (migration, seed, truncate) hay không.
 * Quy tắc:
 * 1. `NODE_ENV` bắt buộc phải là `'test'`.
 * 2. Tên DB bắt buộc phải là `:memory:`, bắt đầu bằng `test_` hoặc kết thúc bằng `_test` (vd: `core_test`).
 */
export function assertSafeTestDatabase(
  databaseName: string | undefined,
  nodeEnv: string | undefined = process.env['NODE_ENV'],
): void {
  if (nodeEnv !== 'test') {
    throw new TestDatabaseSafetyError(
      `Refusing to run test database operation when NODE_ENV="${nodeEnv ?? ''}" (expected "test").`,
    );
  }

  const normalized = (databaseName ?? '').trim();
  if (!normalized) {
    throw new TestDatabaseSafetyError('Database name is empty or undefined.');
  }

  const isSafeName =
    normalized === ':memory:' ||
    normalized.startsWith('test_') ||
    normalized.endsWith('_test') ||
    normalized.includes('_test_');

  if (!isSafeName) {
    throw new TestDatabaseSafetyError(
      `Unsafe database name "${normalized}". Test database must be ":memory:", start with "test_", or end with "_test" (e.g. "core_test") to prevent accidental data loss.`,
    );
  }
}

export interface RollbackTransactionResult<R> {
  readonly result: R;
  readonly rolledBack: boolean;
}

/**
 * Chạy một hàm kiểm thử bên trong một Transaction cô lập và LUÔN LUÔN rollback khi kết thúc.
 * Đảm bảo cơ sở dữ liệu kiểm thử luôn sạch 100% giữa các test case mà không tốn chi phí truncate bảng.
 */
export async function withRollbackTransaction<R>(
  dataSource: Pick<DataSource, 'createQueryRunner' | 'options'>,
  fn: (manager: EntityManager, queryRunner: QueryRunner) => Promise<R>,
): Promise<RollbackTransactionResult<R>> {
  const dbName =
    typeof dataSource.options?.database === 'string' ? dataSource.options.database : 'core_test';
  assertSafeTestDatabase(dbName);

  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  let rolledBack = false;
  try {
    const result = await fn(runner.manager, runner);
    return { result, rolledBack: true };
  } finally {
    try {
      await runner.rollbackTransaction();
      rolledBack = true;
    } finally {
      await runner.release();
    }
    void rolledBack;
  }
}

/**
 * Xóa sạch dữ liệu trong danh sách các bảng trên Database Test (chỉ cho phép khi qua chốt an toàn `assertSafeTestDatabase`).
 */
export async function truncateTestTables(
  dataSource: Pick<DataSource, 'query' | 'options'>,
  tableNames: readonly string[],
): Promise<void> {
  const dbName =
    typeof dataSource.options?.database === 'string' ? dataSource.options.database : undefined;
  assertSafeTestDatabase(dbName);

  if (tableNames.length === 0) return;

  const driverType = String(dataSource.options?.type ?? 'postgres');
  for (const table of tableNames) {
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      throw new TestDatabaseSafetyError(`Invalid table identifier "${table}".`);
    }
  }

  if (driverType === 'postgres') {
    const quoted = tableNames.map((t) => `"${t}"`).join(', ');
    await dataSource.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    return;
  }

  if (driverType === 'mysql' || driverType === 'mariadb') {
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of tableNames) {
        await dataSource.query(`TRUNCATE TABLE \`${table}\``);
      }
    } finally {
      await dataSource.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    return;
  }

  for (const table of tableNames) {
    await dataSource.query(`DELETE FROM "${table}"`);
  }
}
