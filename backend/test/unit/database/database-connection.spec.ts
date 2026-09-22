import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { ModuleRef } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import {
  DatabaseConnectionService,
  QueryInstrumentService,
  databaseKeys,
  type DbEventRecord,
} from '@packages/database/index.js';

/** DataSource giả: `initialize` lỗi `failures` lần đầu; `query` lỗi khi `down = true`. */
function fakeDataSource(failures: number) {
  const state = { isInitialized: false, down: false, attempts: 0 };
  const ds = {
    options: { type: 'mysql' },
    driver: { createQueryRunner: () => ({ query: async () => [] }) },
    get isInitialized() {
      return state.isInitialized;
    },
    initialize: async () => {
      state.attempts++;
      if (state.attempts <= failures)
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), {
          code: 'ECONNREFUSED',
        });
      state.isInitialized = true;
    },
    query: async () => {
      if (state.down)
        throw Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
      return [{ 1: 1 }];
    },
  };
  return { ds: ds as unknown as DataSource, state };
}

describe('DatabaseConnectionService', () => {
  let redis: RedisService;
  let config: CoreConfigService;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    applyTestEnv({ DB_HEALTH_INTERVAL_MS: '1000' });
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await redis.onApplicationShutdown();
  });

  const create = (ds: DataSource) => {
    const moduleRef = { get: () => ds } as unknown as ModuleRef;
    const recorder = new MetricRecorder(config, redis, 'api@test:1');
    const instrument = new QueryInstrumentService(moduleRef, config, recorder, redis);
    return new DatabaseConnectionService(moduleRef, config, instrument, redis, recorder, {
      id: 'api',
      kind: 'long-running',
    });
  };
  const advance = async (ms: number) => {
    await jest.advanceTimersByTimeAsync(ms);
  };

  it('không chặn khởi động: lỗi kết nối → retry backoff → connected', async () => {
    const { ds, state } = fakeDataSource(3);
    const svc = create(ds);
    svc.onApplicationBootstrap();
    expect(svc.getStatus().state).toBe('connecting');

    await advance(0);
    expect(svc.getStatus().lastError).toMatchObject({ code: 'ECONNREFUSED' });
    await advance(1000 + 2000);
    expect(svc.getStatus().state).toBe('unavailable');
    await advance(4000);
    expect(state.attempts).toBe(4);
    expect(svc.getStatus()).toMatchObject({ state: 'connected', lastError: null });
    expect(svc.isConnected()).toBe(true);
    await svc.onApplicationShutdown();
  });

  it('mất kết nối khi đang chạy → reconnecting → unavailable → hồi phục, có sự kiện', async () => {
    const { ds, state } = fakeDataSource(0);
    const svc = create(ds);
    svc.onApplicationBootstrap();
    await advance(0);
    expect(svc.getStatus().state).toBe('connected');

    state.down = true;
    await advance(1000);
    expect(svc.getStatus().state).toBe('reconnecting');
    await advance(2000 + 4000);
    expect(svc.getStatus().state).toBe('unavailable');
    expect((await svc.ping()).ok).toBe(false);

    state.down = false;
    await advance(8000);
    expect(svc.getStatus().state).toBe('connected');

    const events = (await redis.client.lrange(databaseKeys(redis).events(), 0, -1)).map(
      (e) => (JSON.parse(e) as DbEventRecord).type,
    );
    expect(events).toEqual(['connection_recovered', 'connection_lost']);
    await svc.onApplicationShutdown();
  });

  it('DB_ENABLED=false → disabled, không kết nối', async () => {
    applyTestEnv({ DB_ENABLED: 'false' });
    config = new CoreConfigService();
    const { ds, state } = fakeDataSource(0);
    const svc = create(ds);
    svc.onApplicationBootstrap();
    await advance(5000);
    expect(svc.getStatus().state).toBe('disabled');
    expect(state.attempts).toBe(0);
    applyTestEnv({ DB_ENABLED: 'true' });
  });
});
