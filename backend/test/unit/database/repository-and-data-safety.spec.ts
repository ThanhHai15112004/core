import { describe, it, expect, jest } from '@jest/globals';
import { of, lastValueFrom } from 'rxjs';
import { Entity, Column, type DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ConflictAppException,
  HTTP_ERROR_CODE,
  HTTP_STATUS_CODE,
  InternalServerAppException,
} from '@packages/kernel/index.js';
import {
  BaseTypeOrmRepository,
  DataRepairRunnerService,
  DatabaseConnectionService,
  TransactionManager,
  TypeOrmBaseEntity,
  TypeOrmConfigService,
  VersionedTypeOrmEntity,
  classifyDbError,
  isOrmEntityInstance,
  isUniqueConstraintError,
  type DataRepairContract,
} from '@packages/database/index.js';
import { TransformResponseInterceptor } from '@packages/http/interceptors/transform-response.interceptor.js';

@Entity('sample_wallets')
class SampleWalletEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 100 })
  public ownerCode!: string;

  @Column({ type: 'int', default: 0 })
  public balance!: number;
}

class SampleWalletRepository extends BaseTypeOrmRepository<SampleWalletEntity> {
  constructor(dataSource: DataSource, transactionManager: TransactionManager | null = null) {
    super(SampleWalletEntity, dataSource, transactionManager);
  }
}

interface SampleWalletResponseDto {
  id: string;
  ownerCode: string;
  balance: number;
}

/** Tạo mock DataSource và QueryRunner phục vụ kiểm thử Repository, Transaction và Read Replica */
function createMockDataSource(options?: { withReplication?: boolean; updateAffected?: number }) {
  const executedQueries: string[] = [];
  let released = false;
  let slaveReleased = false;

  const createMockRepo = (label: string) => ({
    label,
    findOne: jest.fn(async () => null),
    save: jest.fn(async (entity: unknown) => entity),
    update: jest.fn(async () => ({ affected: options?.updateAffected ?? 1 })),
  });

  const defaultRepo = createMockRepo('master-default');
  const txRepo = createMockRepo('tx-active');
  const slaveRepo = createMockRepo('slave-replica');

  const txManager = {
    query: jest.fn(async (sql: string) => {
      executedQueries.push(sql);
      return [];
    }),
    getRepository: jest.fn(() => txRepo),
  } as unknown as EntityManager;

  const slaveManager = {
    getRepository: jest.fn(() => slaveRepo),
  } as unknown as EntityManager;

  const txQueryRunner = {
    manager: txManager,
    connect: jest.fn(async () => undefined),
    startTransaction: jest.fn(async () => {
      executedQueries.push('BEGIN');
    }),
    commitTransaction: jest.fn(async () => {
      executedQueries.push('COMMIT');
    }),
    rollbackTransaction: jest.fn(async () => {
      executedQueries.push('ROLLBACK');
    }),
    query: jest.fn(async (sql: string) => {
      executedQueries.push(sql);
      return [];
    }),
    release: jest.fn(async () => {
      released = true;
    }),
  } as unknown as QueryRunner;

  const slaveQueryRunner = {
    manager: slaveManager,
    release: jest.fn(async () => {
      slaveReleased = true;
    }),
  } as unknown as QueryRunner;

  const defaultManager = {
    getRepository: jest.fn(() => defaultRepo),
  } as unknown as EntityManager;

  const dataSource = {
    isInitialized: true,
    options: options?.withReplication
      ? {
          replication: {
            master: { host: '127.0.0.1' },
            slaves: [{ host: '10.0.0.2' }],
          },
        }
      : {},
    manager: defaultManager,
    createQueryRunner: jest.fn((mode?: 'master' | 'slave') =>
      mode === 'slave' ? slaveQueryRunner : txQueryRunner,
    ),
  } as unknown as DataSource;

    return {
      dataSource,
      mockConnection: {
        driver: 'mysql',
        connected: () => dataSource,
        getStatus: () => ({ state: 'connected' }),
      } as unknown as DatabaseConnectionService,
      defaultRepo,
      txRepo,
      slaveRepo,
      txQueryRunner,
      slaveQueryRunner,
      executedQueries,
      isReleased: () => released,
      isSlaveReleased: () => slaveReleased,
    };
  }

/** Tạo mock CoreConfigService cho kiểm thử Database */
function createMockConfig(overrides: Partial<CoreConfigService['database']> = {}): CoreConfigService {
  return {
    app: {
      nodeEnv: 'development',
    },
    database: {
      enabled: true,
      connection: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      readHost: '',
      readPort: 3306,
      database: 'core_db',
      username: 'root',
      password: '',
      maxConnections: 10,
      poolMaxIdle: 0,
      poolIdleTimeoutMs: 60_000,
      poolQueueLimit: 0,
      synchronize: false,
      logging: false,
      ssl: false,
      connectTimeoutMs: 5000,
      queryTimeoutMs: 15_000,
      healthIntervalMs: 5000,
      slowQueryMs: 500,
      longTransactionSec: 10,
      transactionTimeoutMs: 5000,
      migrationStrict: true,
      storageLimitGb: 0,
      storageWarnPercent: 80,
      actionsEnabled: true,
      migrationsEnabled: true,
      migrationsTableName: 'core_migrations',
      ...overrides,
    },
  } as unknown as CoreConfigService;
}

describe('2.6 Repository & Data Safety (Repository, Read/Write, Entity Guard, Unique, Optimistic Lock, Dry-Run Repair)', () => {
  describe('1. Module Repository & Automatic Transaction Context Propagation', () => {
    it('uses default DataSource manager outside transaction and automatically switches to TransactionManager inside runInTransaction', async () => {
      const { dataSource, mockConnection, defaultRepo, txRepo } = createMockDataSource();
      const txManager = new TransactionManager(mockConnection, createMockConfig());
      const walletRepo = new SampleWalletRepository(dataSource, txManager);

      // Ngoài transaction -> dùng defaultRepo
      expect((walletRepo.repository as unknown as { label: string }).label).toBe('master-default');
      await walletRepo.findById('wallet-1');
      expect(defaultRepo.findOne).toHaveBeenCalledTimes(1);

      // Trong runInTransaction -> tự động dùng txRepo của phiên giao dịch hiện hành
      await txManager.runInTransaction(async () => {
        expect((walletRepo.repository as unknown as { label: string }).label).toBe('tx-active');
        await walletRepo.findById('wallet-2');
        expect(txRepo.findOne).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('2. Read/Write Separation (When Needed)', () => {
    it('configures replication (master/slaves) in TypeOrmConfigService only when DB_READ_HOST is provided', () => {
      const singleNodeService = new TypeOrmConfigService(createMockConfig({ readHost: '' }));
      const singleOpts = singleNodeService.createTypeOrmOptions() as Record<string, unknown>;
      expect(singleOpts['host']).toBe('127.0.0.1');
      expect(singleOpts['replication']).toBeUndefined();

      const replicatedService = new TypeOrmConfigService(
        createMockConfig({ readHost: '10.0.0.25', readPort: 3307 }),
      );
      const repOpts = replicatedService.createTypeOrmOptions() as {
        replication?: { master: { host: string }; slaves: Array<{ host: string; port: number }> };
      };
      expect(repOpts.replication?.master.host).toBe('127.0.0.1');
      expect(repOpts.replication?.slaves[0]?.host).toBe('10.0.0.25');
      expect(repOpts.replication?.slaves[0]?.port).toBe(3307);
    });

    it('routes executeReadOnly() to slave replica outside transaction, but stays on master transaction manager when inside a transaction', async () => {
      const { dataSource, mockConnection, slaveRepo, txRepo, isSlaveReleased } =
        createMockDataSource({
          withReplication: true,
        });
      const txManager = new TransactionManager(mockConnection, createMockConfig());
      const walletRepo = new SampleWalletRepository(dataSource, txManager);

      // Ngoài transaction -> đọc qua slave replica và tự giải phóng kết nối
      const readLabelOutside = await walletRepo.executeReadOnly(
        async (repo) => (repo as unknown as { label: string }).label,
      );
      expect(readLabelOutside).toBe((slaveRepo as unknown as { label: string }).label);
      expect(isSlaveReleased()).toBe(true);

      // Đang trong transaction -> bắt buộc đọc từ chính transaction hiện hành (Read-your-own-writes)
      await txManager.runInTransaction(async () => {
        const readLabelInside = await walletRepo.executeReadOnly(
          async (repo) => (repo as unknown as { label: string }).label,
        );
        expect(readLabelInside).toBe((txRepo as unknown as { label: string }).label);
      });
    });
  });

  describe('3. Prevent Direct ORM Entity Exposure to API', () => {
    it('detects ORM Entity instances and blocks them in TransformResponseInterceptor while allowing mapped Response DTOs', async () => {
      const interceptor = new TransformResponseInterceptor();
      const mockCtx = {
        switchToHttp: () => ({
          getResponse: () => ({ statusCode: 200 }),
        }),
      } as unknown as ExecutionContext;

      const entity = new SampleWalletEntity();
      entity.id = 'w-100';
      entity.ownerCode = 'USER_01';
      entity.balance = 5000;

      expect(isOrmEntityInstance(entity)).toBe(true);

      // Trả thẳng ORM Entity -> bị chặn bởi TransformResponseInterceptor
      const leakingHandler: CallHandler = {
        handle: () => of(entity),
      };
      await expect(lastValueFrom(interceptor.intercept(mockCtx, leakingHandler))).rejects.toThrow(
        InternalServerAppException,
      );

      // Trả qua Response DTO đã map -> thành công chuẩn envelope
      const dto: SampleWalletResponseDto = {
        id: entity.id,
        ownerCode: entity.ownerCode,
        balance: entity.balance,
      };
      expect(isOrmEntityInstance(dto)).toBe(false);

      const safeHandler: CallHandler = {
        handle: () => of(dto),
      };
      const wrapped = await lastValueFrom(interceptor.intercept(mockCtx, safeHandler));
      expect(wrapped?.success).toBe(true);
      expect(wrapped?.data).toEqual(dto);
    });
  });

  describe('4. Unique Constraint Duplicate Protection', () => {
    it('classifies duplicate key errors across MySQL/Postgres/SQLite and converts them to ConflictAppException (409 DUPLICATE_RESOURCE)', async () => {
      const mysqlDupErr = Object.assign(new Error("Duplicate entry 'A1' for key 'idx_unique'"), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      });
      const pgDupErr = Object.assign(
        new Error('duplicate key value violates unique constraint "users_email_key"'),
        { code: '23505' },
      );

      expect(isUniqueConstraintError(mysqlDupErr)).toBe(true);
      expect(isUniqueConstraintError(pgDupErr)).toBe(true);
      expect(classifyDbError(mysqlDupErr)).toBe('unique_violation');
      expect(classifyDbError(pgDupErr)).toBe('unique_violation');

      const { dataSource, defaultRepo } = createMockDataSource();
      defaultRepo.save.mockRejectedValueOnce(mysqlDupErr as never);

      const walletRepo = new SampleWalletRepository(dataSource, null);

      try {
        await walletRepo.saveEntity({ ownerCode: 'A1', balance: 100 });
        throw new Error('Should have thrown ConflictAppException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ConflictAppException);
        const appErr = err as ConflictAppException;
        expect(appErr.statusCode).toBe(HTTP_STATUS_CODE.CONFLICT);
        expect(appErr.code).toBe(HTTP_ERROR_CODE.DUPLICATE_RESOURCE);
      }
    });
  });

  describe('5. Optimistic Locking for Sensitive Data', () => {
    it('increments version when expectedVersion matches and throws OPTIMISTIC_LOCK_VERSION_MISMATCH (409) when concurrent modification occurs', async () => {
      // Trường hợp 1: Khớp version (affected = 1) -> cập nhật thành công với version + 1
      const { dataSource: okDs, defaultRepo: okRepo } = createMockDataSource({
        updateAffected: 1,
      });
      const okWalletRepo = new SampleWalletRepository(okDs, null);

      await okWalletRepo.updateWithOptimisticLock('w-1', 3, { balance: 900 });
      expect(okRepo.update).toHaveBeenCalledWith(
        { id: 'w-1', version: 3 },
        { balance: 900, version: 4 },
      );

      // Trường hợp 2: Bị sửa đồng thời bởi tiến trình khác (affected = 0) -> ném lỗi 409 OPTIMISTIC_LOCK_VERSION_MISMATCH
      const { dataSource: staleDs } = createMockDataSource({
        updateAffected: 0,
      });
      const staleWalletRepo = new SampleWalletRepository(staleDs, null);

      await expect(
        staleWalletRepo.updateWithOptimisticLock('w-1', 3, { balance: 900 }),
      ).rejects.toMatchObject({
        statusCode: HTTP_STATUS_CODE.CONFLICT,
        code: HTTP_ERROR_CODE.OPTIMISTIC_LOCK_VERSION_MISMATCH,
      });
    });
  });

  describe('6. Data Repair Tool with Safe Dry-Run Rollback', () => {
    it('automatically rolls back database changes in dryRun mode (default) and commits only when dryRun=false (--apply)', async () => {
      const { mockConnection, executedQueries } = createMockDataSource();
      const txManager = new TransactionManager(mockConnection, createMockConfig());
      const runner = new DataRepairRunnerService(mockConnection, txManager);

      const sampleRepairScript: DataRepairContract = {
        name: 'fix-negative-balances',
        description: 'Reset negative wallet balances to zero',
        async execute(manager, context) {
          await manager.query('UPDATE sample_wallets SET balance = 0 WHERE balance < 0');
          return {
            scannedCount: 50,
            affectedCount: 4,
            summary: context.dryRun
              ? 'Would reset 4 negative wallets'
              : 'Reset 4 negative wallets',
          };
        },
      };

      runner.register(sampleRepairScript);

      // Chạy mặc định (dryRun = true) -> chạy SQL trong transaction rồi tự động ROLLBACK
      const dryRunReport = await runner.run('fix-negative-balances');
      expect(dryRunReport.dryRun).toBe(true);
      expect(dryRunReport.status).toBe('DRY_RUN_ROLLED_BACK');
      expect(dryRunReport.affectedCount).toBe(4);
      expect(executedQueries).toEqual([
        'BEGIN',
        'SET SESSION innodb_lock_wait_timeout = 5',
        'UPDATE sample_wallets SET balance = 0 WHERE balance < 0',
        'ROLLBACK',
      ]);

      executedQueries.length = 0;

      // Chạy với dryRun = false (--apply) -> chạy SQL trong transaction và COMMIT
      const applyReport = await runner.run('fix-negative-balances', { dryRun: false });
      expect(applyReport.dryRun).toBe(false);
      expect(applyReport.status).toBe('APPLIED_COMMITTED');
      expect(applyReport.affectedCount).toBe(4);
      expect(executedQueries).toEqual([
        'BEGIN',
        'SET SESSION innodb_lock_wait_timeout = 5',
        'UPDATE sample_wallets SET balance = 0 WHERE balance < 0',
        'COMMIT',
      ]);
    });
  });
});
