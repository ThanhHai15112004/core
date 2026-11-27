import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { DataSource, QueryRunner } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { MigrationLockBusyError, MigrationLockService } from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

function createMockPgDataSource(opts: { advisoryAcquired?: boolean } = {}) {
  const executedSql: string[] = [];
  let released = false;
  const queryRunner = {
    connect: async () => undefined,
    release: async () => {
      released = true;
    },
    query: async (sql: string) => {
      executedSql.push(sql);
      if (sql.includes('pg_try_advisory_lock')) {
        return [{ acquired: opts.advisoryAcquired ?? true }];
      }
      if (sql.includes('pg_advisory_unlock')) {
        return [{ pg_advisory_unlock: true }];
      }
      return [];
    },
  } as unknown as QueryRunner;

  const ds = {
    options: { type: 'postgres' },
    createQueryRunner: () => queryRunner,
  } as unknown as DataSource;

  return { ds, queryRunner, executedSql, isReleased: () => released };
}

describe('MigrationLockService', () => {
  let config: CoreConfigService;
  let redis: RedisService;

  beforeEach(async () => {
    applyTestEnv();
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
  });

  afterEach(async () => {
    await redis.onApplicationShutdown();
  });

  it('acquires both PG advisory lock and Redis owner-token lock, then releases cleanly', async () => {
    const { ds, executedSql, isReleased } = createMockPgDataSource({ advisoryAcquired: true });
    const lockService = new MigrationLockService(config, undefined, redis);

    const handle = await lockService.acquire({ dataSource: ds, owner: 'test-runner' });
    expect(handle.dbLockAcquired).toBe(true);
    expect(handle.redisLockAcquired).toBe(true);
    expect(handle.token.length).toBeGreaterThan(10);

    await handle.release();
    expect(isReleased()).toBe(true);
    expect(executedSql.some((s) => s.includes('pg_try_advisory_lock'))).toBe(true);
    expect(executedSql.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('throws MigrationLockBusyError when DB advisory lock is already held by another instance', async () => {
    const { ds, isReleased } = createMockPgDataSource({ advisoryAcquired: false });
    const lockService = new MigrationLockService(config, undefined, redis);

    await expect(lockService.acquire({ dataSource: ds })).rejects.toThrow(MigrationLockBusyError);
    expect(isReleased()).toBe(true);
  });

  it('prevents concurrent lock acquisition in the same process and allows re-acquire after release', async () => {
    const { ds } = createMockPgDataSource({ advisoryAcquired: true });
    const lockService = new MigrationLockService(config, undefined, redis);

    const first = await lockService.acquire({ dataSource: ds });
    await expect(lockService.acquire({ dataSource: ds })).rejects.toThrow(MigrationLockBusyError);
    await first.release();

    const second = await lockService.acquire({ dataSource: ds });
    expect(second.dbLockAcquired).toBe(true);
    await second.release();
  });

  it('applies and resets PostgreSQL lock_timeout and statement_timeout around DDL execution', async () => {
    const { ds, queryRunner, executedSql } = createMockPgDataSource();
    const lockService = new MigrationLockService(config, undefined, redis);
    void ds;

    const result = await lockService.withLockTimeout(
      queryRunner,
      { lockTimeoutMs: 4500, statementTimeoutMs: 30000, driver: 'postgres' },
      async () => 'done',
    );

    expect(result).toBe('done');
    expect(executedSql).toContain("SET lock_timeout = '4500ms'");
    expect(executedSql).toContain("SET statement_timeout = '30000ms'");
    expect(executedSql).toContain('RESET lock_timeout');
    expect(executedSql).toContain('RESET statement_timeout');
  });
});
