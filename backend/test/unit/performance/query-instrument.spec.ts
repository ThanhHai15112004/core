import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { ModuleRef } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { QueryInstrumentService, normalizeSql, readPoolStats } from '@packages/database/index.js';
import { MetricRecorder, telemetryKeys, type SlowQueryRecord } from '@packages/telemetry/index.js';

const noDataSource = {
  get: () => {
    throw new Error('not found');
  },
} as unknown as ModuleRef;

/** DataSource tối thiểu: driver tạo query runner, `query` mất `ms` rồi trả kết quả hoặc lỗi. */
function fakeDataSource(ms: number, fail = false) {
  const driver = {
    master: { totalCount: 4, idleCount: 1, waitingCount: 2 },
    createQueryRunner: () => ({
      query: async (sql: string) => {
        await new Promise((r) => setTimeout(r, ms));
        if (fail) throw new Error('boom');
        return [{ sql }];
      },
    }),
  };
  return { driver, options: { type: 'postgres' } } as unknown as DataSource;
}

describe('QueryInstrumentService', () => {
  let redis: RedisService;
  let config: CoreConfigService;
  let recorder: MetricRecorder;
  let service: QueryInstrumentService;

  beforeEach(async () => {
    applyTestEnv({ PERF_DB_SLOW_MS: '20' });
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    recorder = new MetricRecorder(config, redis, 'api@host:1');
    service = new QueryInstrumentService(noDataSource, config, recorder, redis);
  });

  afterEach(async () => {
    service.onModuleDestroy();
    await redis.onApplicationShutdown();
  });

  it('không có DataSource → trạng thái no-datasource, không tạo số liệu', async () => {
    service.onApplicationBootstrap();
    expect(service.state).toBe('no-datasource');
    await recorder.flush();
    expect(await redis.client.keys('*perf:b*')).toEqual([]);
  });

  it('đo query qua query runner, cộng vào request hiện tại và lưu slow query đã chuẩn hoá', async () => {
    const ds = fakeDataSource(30);
    service.attach(ds);
    expect(service.state).toBe('active');
    const store = { correlationId: 'corr-9' } as Parameters<RequestContextService['run']>[0];
    await new RequestContextService().run(store, async () => {
      await ds.driver
        .createQueryRunner('master')
        .query("SELECT * FROM users WHERE email = 'a@b.c' AND id = 42");
    });
    expect(store.timings).toMatchObject({ dbQueries: 1 });
    expect(store.timings!.dbMs).toBeGreaterThanOrEqual(25);

    await recorder.flush();
    await new Promise((r) => setTimeout(r, 20));
    const slow = (await redis.client.lrange(telemetryKeys(redis).slowQueries(), 0, -1)).map(
      (r) => JSON.parse(r) as SlowQueryRecord,
    );
    expect(slow).toHaveLength(1);
    expect(slow[0]).toMatchObject({
      sql: 'SELECT * FROM users WHERE email = ? AND id = ?',
      failed: false,
      correlationId: 'corr-9',
    });
  });

  it('query lỗi vẫn được đo và đếm lỗi; lỗi được ném lại cho caller', async () => {
    const ds = fakeDataSource(1, true);
    service.attach(ds);
    await expect(ds.driver.createQueryRunner('master').query('SELECT 1')).rejects.toThrow('boom');
    service.observe('SELECT 1', 2, true);
    await recorder.flush();
    const keys = await redis.client.keys('*perf:b:s10*');
    const hash = await redis.client.hgetall(keys[0]!);
    expect(Number(hash['db.query|n'])).toBe(2);
    expect(Number(hash['db.errors|c'])).toBe(2);
  });
});

describe('normalizeSql / readPoolStats', () => {
  it('bỏ literal, gộp khoảng trắng, cắt SQL dài', () => {
    expect(normalizeSql("select  *\n from t where a = 'x''y' and b in (1, 2.5)")).toBe(
      'select * from t where a = ? and b in (?, ?)',
    );
    expect(normalizeSql('x'.repeat(600))).toHaveLength(501);
  });

  it('đọc pool của pg và mysql2; driver khác → null', () => {
    expect(readPoolStats({ master: { totalCount: 5, idleCount: 2, waitingCount: 1 } })).toEqual({
      used: 3,
      idle: 2,
      waiting: 1,
      total: 5,
    });
    expect(
      readPoolStats({
        pool: { _allConnections: [1, 2, 3], _freeConnections: [1], _connectionQueue: [] },
      }),
    ).toEqual({ used: 2, idle: 1, waiting: 0, total: 3 });
    expect(readPoolStats({})).toBeNull();
  });
});
