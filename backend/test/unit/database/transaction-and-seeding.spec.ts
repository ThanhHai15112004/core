import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  DatabaseConnectionService,
  DatabaseMonitoringService,
  DatabaseOperationsService,
  DatabaseSeederService,
  TransactionManager,
  TransactionTimeoutError,
  computeMigrationChecksum,
  databaseKeys,
} from '@packages/database/index.js';
import { MasterPermissionSeeder } from '../../../src/database/seeders/master-permission.seeder.js';
import { DevelopmentDataSeeder } from '../../../src/database/seeders/development.seeder.js';

function createMockQueryRunner() {
  const queries: { sql: string; params?: unknown[] | undefined }[] = [];
  const state = {
    connected: false,
    started: false,
    committed: false,
    rolledBack: false,
    released: false,
  };
  const manager = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql: sql.trim(), params });
      return [];
    },
  } as unknown as EntityManager;

  const runner = {
    manager,
    connect: async () => {
      state.connected = true;
    },
    startTransaction: async () => {
      state.started = true;
    },
    commitTransaction: async () => {
      state.committed = true;
    },
    rollbackTransaction: async () => {
      state.rolledBack = true;
    },
    release: async () => {
      state.released = true;
    },
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql: sql.trim(), params });
      return [];
    },
  } as unknown as QueryRunner;

  return { runner, manager, queries, state };
}

describe('TransactionManager, Migration Immutability & DatabaseSeederService (2.5)', () => {
  let redis: RedisService;
  let config: CoreConfigService;

  beforeEach(async () => {
    applyTestEnv({
      DB_TRANSACTION_TIMEOUT_MS: '5000',
      DB_MIGRATION_STRICT: 'true',
      OPS_DATABASE_MIGRATIONS_ENABLED: 'true',
    });
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await redis.onApplicationShutdown();
    applyTestEnv();
  });

  const createConnectionSvc = (ds: DataSource) =>
    ({
      connected: () => ds,
      isConnected: () => true,
      get driver() {
        return String(ds.options?.type ?? 'postgres');
      },
      getStatus: () => ({
        state: 'connected',
        since: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastPingMs: 1,
        lastError: null,
        attempts: 1,
      }),
    }) as unknown as DatabaseConnectionService;

  describe('TransactionManager', () => {
    it('commit thành công, truyền EntityManager qua AsyncLocalStorage và hỗ trợ nested SAVEPOINT', async () => {
      const mock = createMockQueryRunner();
      const ds = {
        isInitialized: true,
        options: { type: 'postgres' },
        createQueryRunner: () => mock.runner,
      } as unknown as DataSource;
      const conn = createConnectionSvc(ds);
      const txManager = new TransactionManager(conn, config);

      expect(txManager.getCurrentManager()).toBeNull();

      const res = await txManager.runInTransaction(async (outerManager) => {
        expect(txManager.getCurrentManager()).toBe(outerManager);
        await outerManager.query('INSERT INTO test_outer VALUES (1)');

        // Giao dịch con lồng nhau bị lỗi -> chỉ rollback savepoint, giao dịch cha vẫn tiếp tục
        await expect(
          txManager.runInTransaction(async (innerManager) => {
            expect(innerManager).toBe(outerManager);
            await innerManager.query('INSERT INTO test_inner_fail VALUES (2)');
            throw new Error('Inner failure');
          }),
        ).rejects.toThrow('Inner failure');

        // Giao dịch con lồng nhau thành công -> release savepoint
        await txManager.runInTransaction(async (innerManager) => {
          await innerManager.query('INSERT INTO test_inner_ok VALUES (3)');
        });

        return 'done';
      });

      expect(res).toBe('done');
      expect(mock.state).toEqual({
        connected: true,
        started: true,
        committed: true,
        rolledBack: false,
        released: true,
      });
      const sqlList = mock.queries.map((q) => q.sql);
      expect(sqlList).toContain('SAVEPOINT sp_core_2');
      expect(sqlList).toContain('ROLLBACK TO SAVEPOINT sp_core_2');
      expect(sqlList).toContain('RELEASE SAVEPOINT sp_core_2');
      expect(txManager.getCurrentManager()).toBeNull();
    });

    it('tự động rollback và ném TransactionTimeoutError khi vượt quá transactionTimeoutMs', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const mock = createMockQueryRunner();
      const ds = {
        isInitialized: true,
        options: { type: 'mysql' },
        createQueryRunner: () => mock.runner,
      } as unknown as DataSource;
      const conn = createConnectionSvc(ds);
      const txManager = new TransactionManager(conn, config);

      const txPromise = txManager
        .runInTransaction(() => new Promise<void>(() => undefined), { timeoutMs: 800 })
        .catch((err: unknown) => err);

      await jest.advanceTimersByTimeAsync(800);
      const caught = await txPromise;
      expect(caught).toBeInstanceOf(TransactionTimeoutError);
      expect(mock.state.rolledBack).toBe(true);
      expect(mock.state.committed).toBe(false);
      expect(mock.state.released).toBe(true);
    });
  });

  describe('Migration Checksum & Immutability Guard', () => {
    it('chặn chạy migration (MIGRATION_TAMPERED) nếu bản migration đã applied bị sửa đổi nội dung', async () => {
      const migrationV1 = {
        name: 'CreateUsersTable1700000000001',
        up: async function upV1(qr: QueryRunner) {
          await qr.query('CREATE TABLE users (id INT)');
        },
        down: async function downV1(qr: QueryRunner) {
          await qr.query('DROP TABLE users');
        },
      };

      // Lưu checksum gốc khi migrationV1 đã chạy ở Production
      const originalHash = computeMigrationChecksum(migrationV1);
      await redis.client.hset(
        databaseKeys(redis).migrationChecksums(),
        migrationV1.name,
        originalHash,
      );

      // Giả lập ai đó sửa nội dung hàm up() của migration đã chạy
      const tamperedMigrationV1 = {
        name: 'CreateUsersTable1700000000001',
        up: async function upTampered(qr: QueryRunner) {
          await qr.query('CREATE TABLE users (id INT, email VARCHAR(255))');
        },
        down: migrationV1.down,
      };

      const ds = {
        isInitialized: true,
        options: { type: 'mysql' },
        migrations: [tamperedMigrationV1],
        createQueryRunner: () => ({
          connect: async () => undefined,
          release: async () => undefined,
          query: async () => [{ name: 'CreateUsersTable1700000000001', timestamp: 1700000000001 }],
        }),
        runMigrations: async () => [],
      } as unknown as DataSource;

      const conn = createConnectionSvc(ds);
      const monitoring = new DatabaseMonitoringService(conn, config);
      const ops = new DatabaseOperationsService(conn, monitoring, config, redis);

      const status = await ops.migrations();
      expect(status.items[0]).toMatchObject({
        name: 'CreateUsersTable1700000000001',
        status: 'applied',
        integrity: 'modified',
      });

      await expect(ops.runMigrations()).rejects.toMatchObject({
        code: 'MIGRATION_TAMPERED',
      });
    });

    it('chặn rollback migration trên môi trường production nếu không có cờ force', async () => {
      applyTestEnv({ NODE_ENV: 'production', OPS_DATABASE_MIGRATIONS_ENABLED: 'true' });
      config = new CoreConfigService();

      let undone = false;
      const ds = {
        isInitialized: true,
        options: { type: 'mysql' },
        migrations: [],
        undoLastMigration: async () => {
          undone = true;
        },
      } as unknown as DataSource;

      const conn = createConnectionSvc(ds);
      const monitoring = new DatabaseMonitoringService(conn, config);
      const ops = new DatabaseOperationsService(conn, monitoring, config, redis);

      await expect(ops.revertLastMigration()).rejects.toMatchObject({
        code: 'ROLLBACK_FORBIDDEN',
      });
      expect(undone).toBe(false);

      const forced = await ops.revertLastMigration({ force: true });
      expect(forced.status).toBe('completed');
      expect(undone).toBe(true);
    });
  });

  describe('DatabaseSeederService (Master Permission & Development Seeders)', () => {
    it('chạy MasterPermissionSeeder và DevelopmentDataSeeder trong transaction ở môi trường dev/test', async () => {
      const mock = createMockQueryRunner();
      const ds = {
        isInitialized: true,
        options: { type: 'postgres' },
        createQueryRunner: () => mock.runner,
      } as unknown as DataSource;

      const conn = createConnectionSvc(ds);
      const txManager = new TransactionManager(conn, config);
      const seederSvc = new DatabaseSeederService(conn, txManager, config, redis);

      const seeders = [
        new MasterPermissionSeeder([
          { code: 'health.read', module: 'health', description: 'Read health status' },
        ]),
        new DevelopmentDataSeeder(),
      ];

      const summary = await seederSvc.runSeeders(seeders, { scope: 'all' });
      expect(summary.completed).toBe(2);
      expect(summary.skipped).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.items.map((i) => i.name)).toEqual([
        'MasterPermissionAndSettingsSeeder',
        'DevelopmentSampleDataSeeder',
      ]);
    });

    it('chặn chạy DevelopmentDataSeeder khi NODE_ENV=production', async () => {
      applyTestEnv({ NODE_ENV: 'production' });
      config = new CoreConfigService();

      const mock = createMockQueryRunner();
      const ds = {
        isInitialized: true,
        options: { type: 'postgres' },
        createQueryRunner: () => mock.runner,
      } as unknown as DataSource;

      const conn = createConnectionSvc(ds);
      const txManager = new TransactionManager(conn, config);
      const seederSvc = new DatabaseSeederService(conn, txManager, config, redis);

      const seeders = [
        new MasterPermissionSeeder([
          { code: 'health.read', module: 'health', description: 'Read health status' },
        ]),
        new DevelopmentDataSeeder(),
      ];

      // Chạy trực tiếp scope = development trên production -> ném lỗi SEED_ENV_FORBIDDEN
      await expect(seederSvc.runSeeders(seeders, { scope: 'development' })).rejects.toMatchObject({
        code: 'SEED_ENV_FORBIDDEN',
      });

      // Chạy scope = all trên production -> chỉ chạy master, tự động skip development
      const summary = await seederSvc.runSeeders(seeders, { scope: 'all' });
      expect(summary.completed).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(summary.items.find((i) => i.scope === 'development')?.status).toBe('skipped');
    });
  });
});
