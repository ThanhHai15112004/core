import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { DataSource, EntityManager, QueryRunner, Repository } from 'typeorm';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  BaseTypeOrmRepository,
  DatabaseConnectionService,
  DatabaseRoutingService,
  MysqlMonitoringProvider,
  PostgresMonitoringProvider,
  TransactionManager,
  TypeOrmConfigService,
  databaseKeys,
  isReplicaFallbackableError,
  resetActiveDatabaseRouter,
  setActiveDatabaseRouter,
  type DbEventRecord,
  type MonitoringContext,
} from '@packages/database/index.js';
import { UserRepository } from '../../../src/modules/users/repositories/user.repository.js';
import { evaluateDbRules, type DbRuleInput } from '@modules/database-ops/index.js';

interface FakeRecord {
  id: number;
  name: string;
  version: number;
}

class FakeRecordEntity {
  public id!: number;
  public name!: string;
  public version!: number;
}

class FakeRecordRepository extends BaseTypeOrmRepository<FakeRecordEntity> {
  constructor(
    dataSource: DataSource,
    transactionManager: TransactionManager | null,
    routing: DatabaseRoutingService,
  ) {
    super(FakeRecordEntity, dataSource, transactionManager, routing);
  }
}

function createPrimaryReplicaHarness(options?: {
  replicaFailError?: unknown;
  replicaPingFail?: boolean;
}) {
  const primaryStore: FakeRecord[] = [{ id: 1, name: 'initial-primary', version: 1 }];
  const replicaStore: FakeRecord[] = [{ id: 1, name: 'stale-replica', version: 1 }];
  const runnerModes: Array<string | undefined> = [];
  const state = {
    replicaFailError: options?.replicaFailError ?? null,
    replicaPingFail: options?.replicaPingFail ?? false,
    masterQueries: 0,
    slaveQueries: 0,
    slaveReleases: 0,
    masterReleases: 0,
  };

  const makeRepo = (store: FakeRecord[], mode: 'master' | 'slave') =>
    ({
      findOne: async ({ where }: { where: { id: number } }) => {
        if (mode === 'master') state.masterQueries += 1;
        else state.slaveQueries += 1;
        return store.find((r) => r.id === where.id) ?? null;
      },
      save: async (entity: Partial<FakeRecord>) => {
        if (mode === 'slave') {
          throw new Error('Cannot write on read replica');
        }
        state.masterQueries += 1;
        const idx = store.findIndex((r) => r.id === entity.id);
        const next: FakeRecord = {
          id: entity.id ?? store.length + 1,
          name: entity.name ?? 'saved',
          version: entity.version ?? 1,
        };
        if (idx >= 0) store[idx] = next;
        else store.push(next);
        return next;
      },
      update: async (criteria: { id: number; version?: number }, partial: Partial<FakeRecord>) => {
        if (mode === 'slave') {
          throw new Error('Cannot write on read replica');
        }
        state.masterQueries += 1;
        const target = store.find(
          (r) =>
            r.id === criteria.id &&
            (criteria.version === undefined || r.version === criteria.version),
        );
        if (!target) return { affected: 0 };
        Object.assign(target, partial);
        return { affected: 1 };
      },
    }) as unknown as Repository<FakeRecordEntity>;

  const makeManager = (mode: 'master' | 'slave'): EntityManager =>
    ({
      getRepository: () => makeRepo(mode === 'master' ? primaryStore : replicaStore, mode),
      query: async (sql: string) => {
        if (mode === 'master') state.masterQueries += 1;
        else state.slaveQueries += 1;
        if (sql.includes('INSERT INTO primary_only')) {
          primaryStore.push({ id: 99, name: 'tx-written', version: 1 });
        }
        return [];
      },
    }) as unknown as EntityManager;

  const masterManager = makeManager('master');
  const slaveManager = makeManager('slave');

  const ds = {
    isInitialized: true,
    options: {
      type: 'postgres',
      replication: {
        defaultMode: 'master',
        master: { host: 'primary-db', port: 5432 },
        slaves: [{ host: 'replica-db', port: 5432 }],
      },
    },
    manager: masterManager,
    createQueryRunner: (mode?: 'master' | 'slave') => {
      runnerModes.push(mode);
      const effectiveMode: 'master' | 'slave' = mode === 'slave' ? 'slave' : 'master';
      const runner = {
        manager: effectiveMode === 'slave' ? slaveManager : masterManager,
        connect: async () => {
          if (effectiveMode === 'slave' && state.replicaFailError) {
            throw state.replicaFailError;
          }
        },
        startTransaction: async () => undefined,
        commitTransaction: async () => undefined,
        rollbackTransaction: async () => undefined,
        release: async () => {
          if (effectiveMode === 'slave') state.slaveReleases += 1;
          else state.masterReleases += 1;
        },
        query: async (sql: string) => {
          if (effectiveMode === 'slave') {
            state.slaveQueries += 1;
            if (state.replicaPingFail && sql.trim().toUpperCase() === 'SELECT 1') {
              throw Object.assign(new Error('connect ECONNREFUSED replica-db:5432'), {
                code: 'ECONNREFUSED',
              });
            }
            if (state.replicaFailError) {
              throw state.replicaFailError;
            }
          } else {
            state.masterQueries += 1;
          }
          return [];
        },
      } as unknown as QueryRunner;

      if (effectiveMode === 'slave' && state.replicaFailError) {
        // Trigger failure either on runner usage/work or connect
        return {
          ...runner,
          manager: {
            getRepository: () =>
              ({
                findOne: async () => {
                  throw state.replicaFailError;
                },
              }) as unknown as Repository<FakeRecordEntity>,
          } as unknown as EntityManager,
        } as unknown as QueryRunner;
      }

      return runner;
    },
  } as unknown as DataSource;

  return { ds, primaryStore, replicaStore, runnerModes, state };
}

describe('13.3 Primary & Read Replica: Config, Routing, Read-After-Write, Fallback & Lag Monitoring', () => {
  let redis: RedisService;
  let config: CoreConfigService;

  beforeEach(async () => {
    resetActiveDatabaseRouter();
    applyTestEnv({
      DB_READ_HOST: 'replica-1.internal',
      DB_READ_PORT: '5433',
      DB_READ_HOSTS: 'replica-2.internal:5434,replica-1.internal:5433',
      DB_READ_AFTER_WRITE_WINDOW_MS: '3000',
      DB_REPLICA_FALLBACK_COOLDOWN_MS: '10000',
      DB_REPLICATION_LAG_WARN_MS: '1000',
      DB_REPLICATION_LAG_CRIT_MS: '5000',
      DB_REPLICA_FALLBACK_ON_CRITICAL_LAG: 'true',
    });
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
  });

  afterEach(async () => {
    jest.useRealTimers();
    resetActiveDatabaseRouter();
    await redis.onApplicationShutdown();
    applyTestEnv();
  });

  describe('1. Tách cấu hình Primary và Read Replica', () => {
    it('chuẩn hóa danh sách readReplicas từ DB_READ_HOST + DB_READ_HOSTS (khử trùng lặp) và cấu hình TypeORM defaultMode=master', () => {
      applyTestEnv({
        DB_CONNECTION: 'pgsql',
        DB_HOST: 'primary.internal',
        DB_PORT: '5432',
        DB_READ_HOST: 'replica-1.internal',
        DB_READ_PORT: '5433',
        DB_READ_HOSTS: 'replica-2.internal:5434,replica-1.internal:5433,replica-3.internal',
        DB_READ_USERNAME: 'readonly_user',
        DB_READ_PASSWORD: 'readonly_pass',
        DB_READ_DATABASE: 'core_read_db',
      });
      const cfg = new CoreConfigService();
      expect(cfg.database.readReplicas).toEqual([
        {
          host: 'replica-1.internal',
          port: 5433,
          username: 'readonly_user',
          password: 'readonly_pass',
          database: 'core_read_db',
        },
        {
          host: 'replica-2.internal',
          port: 5434,
          username: 'readonly_user',
          password: 'readonly_pass',
          database: 'core_read_db',
        },
        {
          host: 'replica-3.internal',
          port: 5433,
          username: 'readonly_user',
          password: 'readonly_pass',
          database: 'core_read_db',
        },
      ]);

      const ormOpts = new TypeOrmConfigService(cfg).createTypeOrmOptions() as {
        replication?: {
          defaultMode?: string;
          master?: { host: string; port: number };
          slaves?: Array<{ host: string; port: number; username: string }>;
        };
      };
      expect(ormOpts.replication?.defaultMode).toBe('master');
      expect(ormOpts.replication?.master).toMatchObject({ host: 'primary.internal', port: 5432 });
      expect(ormOpts.replication?.slaves).toHaveLength(3);
    });
  });

  describe('2. Mọi Transaction phải dùng Primary', () => {
    it('TransactionManager luôn gọi createQueryRunner("master") và đọc trong transaction không trượt sang Replica', async () => {
      const harness = createPrimaryReplicaHarness();
      const conn = {
        connected: () => harness.ds,
        driver: 'postgres',
        getStatus: () => ({ state: 'connected' }),
      } as unknown as DatabaseConnectionService;
      const router = new DatabaseRoutingService(config, redis);
      setActiveDatabaseRouter(router);
      const txManager = new TransactionManager(conn, config, undefined, router);
      const repo = new FakeRecordRepository(harness.ds, txManager, router);

      const insideTx = await txManager.runInTransaction(async (manager) => {
        await manager.query('INSERT INTO primary_only VALUES (99)');
        return repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } }));
      });

      expect(harness.runnerModes[0]).toBe('master');
      expect(insideTx.dataSourceUsed).toBe('PRIMARY');
      expect(insideTx.routingReason).toBe('in_transaction');
      expect(insideTx.data?.name).toBe('initial-primary');
      expect(harness.state.slaveQueries).toBe(0);

      await txManager.startTransaction();
      expect(harness.runnerModes[harness.runnerModes.length - 1]).toBe('master');
      await txManager.commit();
    });
  });

  describe('3. Read-After-Write (đọc Primary ngay sau khi ghi)', () => {
    it('trong cùng request: sau saveEntity/updateWithOptimisticLock, đọc tiếp lập tức đi qua Primary và thấy dữ liệu mới', async () => {
      const harness = createPrimaryReplicaHarness();
      const conn = {
        connected: () => harness.ds,
        driver: 'postgres',
        getStatus: () => ({ state: 'connected' }),
      } as unknown as DatabaseConnectionService;
      const router = new DatabaseRoutingService(config, redis);
      const txManager = new TransactionManager(conn, config, undefined, router);
      const repo = new FakeRecordRepository(harness.ds, txManager, router);

      await router.runInReadWriteScope(async () => {
        // Trước khi ghi: đọc từ Replica
        const beforeWrite = await repo.executeReadOnlyWithMeta((r) =>
          r.findOne({ where: { id: 1 } }),
        );
        expect(beforeWrite.dataSourceUsed).toBe('REPLICA');
        expect(beforeWrite.data?.name).toBe('stale-replica');

        // Ghi trên Primary
        await repo.saveEntity({ id: 1, name: 'fresh-on-primary', version: 2 });

        // Đọc lại ngay trong cùng request: phải đi qua Primary
        const afterWrite = await repo.executeReadOnlyWithMeta((r) =>
          r.findOne({ where: { id: 1 } }),
        );
        expect(afterWrite.dataSourceUsed).toBe('PRIMARY');
        expect(afterWrite.routingReason).toBe('read_after_write_request');
        expect(afterWrite.data?.name).toBe('fresh-on-primary');
      });
    });

    it('xuyên request theo actor trong RequestContextService: cùng user đọc Primary trong cửa sổ TTL, user khác vẫn đọc Replica, hết TTL tự quay lại Replica', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const harness = createPrimaryReplicaHarness();
      const conn = {
        connected: () => harness.ds,
        driver: 'postgres',
        getStatus: () => ({ state: 'connected' }),
      } as unknown as DatabaseConnectionService;

      // Hai instance router (mô phỏng 2 worker/API pod dùng chung Redis)
      const writerRouter = new DatabaseRoutingService(config, redis);
      const readerRouter = new DatabaseRoutingService(config, redis);
      const txManager = new TransactionManager(conn, config, undefined, writerRouter);
      const writerRepo = new FakeRecordRepository(harness.ds, txManager, writerRouter);
      const readerRepo = new FakeRecordRepository(harness.ds, null, readerRouter);

      // Request 1 của user u-42 thực hiện ghi qua optimistic lock
      await RequestContextService.runWith({ correlationId: 'req-1', userId: 'u-42' }, async () => {
        await writerRepo.updateWithOptimisticLock(1, 1, { name: 'updated-by-u42' });
      });

      // Request 2 của user u-42 trên node khác đọc ngay sau đó -> phải pin về Primary qua Redis/window
      const u42ImmediateRead = await RequestContextService.runWith(
        { correlationId: 'req-2', userId: 'u-42' },
        () => readerRepo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } })),
      );
      expect(u42ImmediateRead.dataSourceUsed).toBe('PRIMARY');
      expect(u42ImmediateRead.routingReason).toBe('read_after_write_window');
      expect(u42ImmediateRead.data?.name).toBe('updated-by-u42');

      // Request của user u-99 đọc song song -> vẫn đi qua Replica
      const u99Read = await RequestContextService.runWith(
        { correlationId: 'req-3', userId: 'u-99' },
        () => readerRepo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } })),
      );
      expect(u99Read.dataSourceUsed).toBe('REPLICA');
      expect(u99Read.routingReason).toBe('replica_ok');

      // Sau khi hết cửa sổ DB_READ_AFTER_WRITE_WINDOW_MS (3000ms) -> u-42 quay lại đọc Replica
      await jest.advanceTimersByTimeAsync(3500);
      await redis.client.del(databaseKeys(redis).writeStickiness('u-42'));
      const u42AfterWindow = await RequestContextService.runWith(
        { correlationId: 'req-4', userId: 'u-42' },
        () => readerRepo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } })),
      );
      expect(u42AfterWindow.dataSourceUsed).toBe('REPLICA');
      expect(u42AfterWindow.routingReason).toBe('replica_ok');
    });

    it('runWithPrimaryRead() và forcePrimary ép đọc Primary tường minh', async () => {
      const harness = createPrimaryReplicaHarness();
      const router = new DatabaseRoutingService(config, redis);
      const repo = new FakeRecordRepository(harness.ds, null, router);

      const scoped = await repo.runWithPrimaryRead(() =>
        repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } })),
      );
      expect(scoped.dataSourceUsed).toBe('PRIMARY');
      expect(scoped.routingReason).toBe('forced_primary');

      const forced = await repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } }), {
        forcePrimary: true,
      });
      expect(forced.dataSourceUsed).toBe('PRIMARY');
      expect(forced.routingReason).toBe('forced_primary');
    });
  });

  describe('4. Báo cáo đọc từ Read Replica & Fallback an toàn', () => {
    it('intent="report" luôn ưu tiên Replica kể cả khi actor vừa ghi, nhưng vẫn hỗ trợ forcePrimary và tự fallback khi Replica lỗi', async () => {
      const harness = createPrimaryReplicaHarness();
      const router = new DatabaseRoutingService(config, redis);
      setActiveDatabaseRouter(router);
      const repo = new FakeRecordRepository(harness.ds, null, router);

      await router.runInReadWriteScope(
        async () => {
          await repo.saveEntity({ id: 1, name: 'fresh-write', version: 2 });

          // Đọc thường dính Read-After-Write -> Primary
          const normalRead = await repo.executeReadOnlyWithMeta((r) =>
            r.findOne({ where: { id: 1 } }),
          );
          expect(normalRead.dataSourceUsed).toBe('PRIMARY');

          // Báo cáo (intent: 'report') vẫn ưu tiên Replica để giảm tải Primary
          const reportRead = await repo.executeReadOnlyWithMeta(
            (r) => r.findOne({ where: { id: 1 } }),
            { intent: 'report' },
          );
          expect(reportRead.dataSourceUsed).toBe('REPLICA');
          expect(reportRead.routingReason).toBe('replica_ok');
        },
        { actorKey: 'admin-1' },
      );

      // Kiểm tra UserRepository.searchPaginatedReadOnly tích hợp intent='report' + fallback
      const mockUsersResult = { items: [], total: 0 };
      const userRepo = new UserRepository(harness.ds, null);
      jest.spyOn(userRepo, 'searchPaginated').mockImplementation(async (_filter, repoOverride) => {
        if (repoOverride && harness.state.replicaFailError) {
          await repoOverride.findOne({ where: { id: 1 } } as never);
        }
        return mockUsersResult;
      });

      const reportRes = await userRepo.searchPaginatedReadOnly({}, true);
      expect(reportRes.dataSourceUsed).toBe('REPLICA');

      const primaryReportRes = await userRepo.searchPaginatedReadOnly({}, false);
      expect(primaryReportRes.dataSourceUsed).toBe('PRIMARY');

      // Nếu Replica lỗi kết nối -> report tự fallback về Primary không làm hỏng báo cáo
      harness.state.replicaFailError = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
      const fallbackReportRes = await userRepo.searchPaginatedReadOnly({}, true);
      expect(fallbackReportRes.dataSourceUsed).toBe('PRIMARY');
    });
  });

  describe('5. Tự chuyển về Primary khi Replica lỗi & Circuit Breaker tự phục hồi', () => {
    it('Replica lỗi kết nối → fallback Primary không làm hỏng request, mở mạch tạm thời rồi tự phục hồi sau cooldown', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const harness = createPrimaryReplicaHarness({
        replicaFailError: Object.assign(new Error('connect ECONNREFUSED 10.0.0.2:5432'), {
          code: 'ECONNREFUSED',
        }),
      });
      const router = new DatabaseRoutingService(config, redis);
      const repo = new FakeRecordRepository(harness.ds, null, router);

      // Lần 1: Replica lỗi -> tự fallback về Primary, request vẫn thành công
      const first = await repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } }));
      expect(first.dataSourceUsed).toBe('PRIMARY');
      expect(first.routingReason).toBe('replica_fallback');
      expect(first.data?.name).toBe('initial-primary');

      let snap = router.getSnapshot();
      expect(snap.circuitState).toBe('open');
      expect(snap.fallbackCount).toBe(1);
      expect(snap.replicaAvailable).toBe(false);

      // Lần 2 trong thời gian cooldown: đi thẳng Primary mà không chạm slave
      const slaveCallsBefore = harness.runnerModes.filter((m) => m === 'slave').length;
      const second = await repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } }));
      const slaveCallsAfter = harness.runnerModes.filter((m) => m === 'slave').length;
      expect(second.dataSourceUsed).toBe('PRIMARY');
      expect(second.routingReason).toBe('replica_circuit_open');
      expect(slaveCallsAfter).toBe(slaveCallsBefore);

      // Replica phục hồi sau cooldown -> tự đóng mạch và đọc lại trên Replica
      harness.state.replicaFailError = null;
      await jest.advanceTimersByTimeAsync(10_500);
      const recovered = await repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } }));
      expect(recovered.dataSourceUsed).toBe('REPLICA');
      expect(recovered.routingReason).toBe('replica_ok');

      snap = router.getSnapshot();
      expect(snap.circuitState).toBe('closed');
      expect(snap.replicaAvailable).toBe(true);

      await Promise.resolve();
      const events = (await redis.client.lrange(databaseKeys(redis).events(), 0, -1)).map(
        (raw) => (JSON.parse(raw) as DbEventRecord).type,
      );
      expect(events).toContain('replica_fallback');
      expect(events).toContain('replica_recovered');
    });

    it('không fallback lỗi cú pháp SQL / lỗi nghiệp vụ sang Primary', async () => {
      const sqlSyntaxErr = Object.assign(new Error('syntax error near "FROMM"'), {
        code: 'ER_PARSE_ERROR',
      });
      expect(isReplicaFallbackableError(sqlSyntaxErr)).toBe(false);
      expect(isReplicaFallbackableError({ code: 'ECONNREFUSED' })).toBe(true);
      expect(isReplicaFallbackableError({ code: '57P03' })).toBe(true);

      const harness = createPrimaryReplicaHarness({ replicaFailError: sqlSyntaxErr });
      const router = new DatabaseRoutingService(config, redis);
      const repo = new FakeRecordRepository(harness.ds, null, router);

      await expect(
        repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } })),
      ).rejects.toThrow(/syntax error/);
      expect(router.getSnapshot().circuitState).toBe('closed');
      expect(router.getSnapshot().fallbackCount).toBe(0);
    });
  });

  describe('6. Theo dõi Replication Lag & Cảnh báo', () => {
    const ctxOf = (rows: Record<string, unknown>[][], failFirst = false): MonitoringContext => {
      let i = 0;
      let called = 0;
      return {
        database: 'core_db',
        user: 'core',
        run: (async () => {
          called += 1;
          if (failFirst && called === 1) {
            throw new Error('Unknown syntax SHOW REPLICA STATUS');
          }
          return rows[i++] ?? [];
        }) as MonitoringContext['run'],
      };
    };

    it('MysqlMonitoringProvider & PostgresMonitoringProvider đọc replication lag chính xác', async () => {
      const mysql = new MysqlMonitoringProvider();
      const mysqlLag = await mysql.replicationLag(
        ctxOf([
          [
            {
              Replica_IO_Running: 'Yes',
              Replica_SQL_Running: 'Yes',
              Seconds_Behind_Source: 2.5,
              Last_Error: '',
            },
          ],
        ]),
      );
      expect(mysqlLag).toEqual({
        role: 'replica',
        state: 'streaming',
        lagMs: 2500,
        ioRunning: true,
        sqlRunning: true,
        lastError: null,
      });

      // Fallback sang SHOW SLAVE STATUS cho MySQL cũ
      const mysqlLegacy = await mysql.replicationLag(
        ctxOf(
          [
            [
              {
                Slave_IO_Running: 'Yes',
                Slave_SQL_Running: 'No',
                Seconds_Behind_Master: 12,
                Last_SQL_Error: 'Duplicate key',
              },
            ],
          ],
          true,
        ),
      );
      expect(mysqlLegacy).toMatchObject({
        role: 'replica',
        state: 'stopped',
        lagMs: 12000,
        ioRunning: true,
        sqlRunning: false,
        lastError: 'Duplicate key',
      });

      const pg = new PostgresMonitoringProvider();
      const pgLag = await pg.replicationLag(ctxOf([[{ in_recovery: true, lag_ms: 1450.4 }]]));
      expect(pgLag).toEqual({
        role: 'replica',
        state: 'streaming',
        lagMs: 1450,
        ioRunning: true,
        sqlRunning: true,
        lastError: null,
      });
    });

    it('evaluateDbRules phát cảnh báo REPLICATION_LAG / REPLICA_UNAVAILABLE và chuyển luồng đọc thường về Primary khi lag nghiêm trọng', async () => {
      const baseInput: DbRuleInput = {
        connection: 'connected',
        pool: { used: 2, limit: 10, waiting: 0 },
        queries: 100,
        avgMs: 5,
        errorRatePercent: 0,
        longestTransactionSec: 0,
        lockWaits: { count: 0, maxWaitMs: 0 },
        storage: { bytes: null, limitBytes: null },
      };
      const ruleCfg = {
        db: {
          longTransactionSec: 10,
          storageWarnPercent: 80,
          replicationLagWarnMs: 1_000,
          replicationLagCritMs: 5_000,
        },
        dbAvgMs: { warn: 200, crit: 500 },
        dbPoolPercent: { warn: 70, crit: 85 },
        errorRatePercent: { warn: 2, crit: 5 },
        minQueries: 20,
      };

      const warnAlerts = evaluateDbRules(
        { ...baseInput, replication: { configured: true, available: true, lagMs: 2_500 } },
        ruleCfg,
      );
      expect(warnAlerts.find((a) => a.id === 'REPLICATION_LAG')).toMatchObject({
        severity: 'warning',
        value: 2500,
        threshold: 1000,
        unit: 'ms',
      });

      const critAlerts = evaluateDbRules(
        { ...baseInput, replication: { configured: true, available: true, lagMs: 6_200 } },
        ruleCfg,
      );
      expect(critAlerts.find((a) => a.id === 'REPLICATION_LAG')).toMatchObject({
        severity: 'critical',
        value: 6200,
        threshold: 5000,
      });

      const downAlerts = evaluateDbRules(
        { ...baseInput, replication: { configured: true, available: false, lagMs: null } },
        ruleCfg,
      );
      expect(downAlerts.find((a) => a.id === 'REPLICA_UNAVAILABLE')).toMatchObject({
        severity: 'critical',
      });

      // Khi lag vượt ngưỡng nghiêm trọng, đọc thường tự chuyển về Primary còn báo cáo vẫn đọc Replica
      const harness = createPrimaryReplicaHarness();
      const router = new DatabaseRoutingService(config, redis);
      router.updateReplicationHealth({ available: true, lagMs: 6_500 });
      const repo = new FakeRecordRepository(harness.ds, null, router);

      const normal = await repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } }));
      expect(normal.dataSourceUsed).toBe('PRIMARY');
      expect(normal.routingReason).toBe('replication_lag_critical');

      const report = await repo.executeReadOnlyWithMeta((r) => r.findOne({ where: { id: 1 } }), {
        intent: 'report',
      });
      expect(report.dataSourceUsed).toBe('REPLICA');
      expect(report.routingReason).toBe('replica_ok');
    });
  });
});
