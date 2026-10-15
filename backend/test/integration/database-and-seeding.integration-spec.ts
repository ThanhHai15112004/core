import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { applyTestEnv } from '../fixtures/env.fixture.js';
import { defineFactory } from '../fixtures/data-factory.fixture.js';
import { mockRedisFactory } from '../concerns/test-app.concern.js';
import {
  assertSafeTestDatabase,
  withRollbackTransaction,
} from '../concerns/test-database.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  type DatabaseConnectionService,
  DatabaseSeederService,
  TransactionManager,
  type ISeeder,
} from '@packages/database/index.js';

interface PermissionRecord {
  code: string;
  module: string;
  description: string;
}

const permissionRecordFactory = defineFactory<PermissionRecord>((seq) => ({
  code: `module.action_${seq}`,
  module: 'test-module',
  description: `Test permission #${seq}`,
}));

describe('Integration: Database, Transaction Rollback, Seeding & Redis (Task 2.7.2 & 2.7.4)', () => {
  let config: CoreConfigService;
  let redis: RedisService;

  beforeEach(async () => {
    applyTestEnv({
      NODE_ENV: 'test',
      DB_DATABASE: 'core_test',
      DB_TRANSACTION_TIMEOUT_MS: '5000',
    });
    permissionRecordFactory.resetSequence();
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
  });

  afterEach(async () => {
    await redis.onApplicationShutdown();
    applyTestEnv();
  });

  it('phối hợp DataFactory + withRollbackTransaction + TransactionManager + Redis trên DB core_test', async () => {
    assertSafeTestDatabase(config.database.database, config.app.env);

    const committedRows: PermissionRecord[] = [];
    let stagedRows: PermissionRecord[] = [];

    const manager = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('INSERT INTO permissions')) {
          stagedRows.push({
            code: String(params?.[0] ?? ''),
            module: String(params?.[1] ?? ''),
            description: String(params?.[2] ?? ''),
          });
        }
        return [];
      },
    } as unknown as EntityManager;

    const runner = {
      manager,
      connect: async () => undefined,
      startTransaction: async () => {
        stagedRows = [...committedRows];
      },
      commitTransaction: async () => {
        committedRows.splice(0, committedRows.length, ...stagedRows);
      },
      rollbackTransaction: async () => {
        stagedRows = [...committedRows];
      },
      release: async () => undefined,
    } as unknown as QueryRunner;

    const ds = {
      isInitialized: true,
      options: { type: 'postgres', database: config.database.database },
      createQueryRunner: () => runner,
    } as unknown as DataSource;

    const connSvc = {
      connected: () => ds,
      isConnected: () => true,
      driver: 'postgres',
    } as unknown as DatabaseConnectionService;

    const txManager = new TransactionManager(connSvc, config);
    const seederSvc = new DatabaseSeederService(connSvc, txManager, config, redis);

    // 1. Chạy trong withRollbackTransaction: tạo 3 bản ghi bằng Factory nhưng cuối cùng tự động rollback
    const rollbackRun = await withRollbackTransaction(ds, async (em) => {
      const generated = permissionRecordFactory.buildMany(3);
      for (const item of generated) {
        await em.query('INSERT INTO permissions VALUES ($1, $2, $3)', [
          item.code,
          item.module,
          item.description,
        ]);
      }
      expect(stagedRows).toHaveLength(3);
      return generated.length;
    });

    expect(rollbackRun.result).toBe(3);
    expect(rollbackRun.rolledBack).toBe(true);
    expect(committedRows).toHaveLength(0);

    // 2. Chạy Seeder tích hợp qua TransactionManager & lưu lịch sử vào Redis
    const customSeeder: ISeeder = {
      name: 'IntegrationPermissionSeeder',
      scope: 'master',
      run: async ({ manager }) => {
        const items = permissionRecordFactory.buildMany(2, { module: 'iam' });
        for (const item of items) {
          await manager.query('INSERT INTO permissions VALUES ($1, $2, $3)', [
            item.code,
            item.module,
            item.description,
          ]);
        }
        return { affected: items.length };
      },
    };

    const seedSummary = await seederSvc.runSeeders([customSeeder], { scope: 'master' });
    expect(seedSummary.completed).toBe(1);
    expect(committedRows).toHaveLength(2);
    expect(committedRows[0]?.module).toBe('iam');
  });
});
