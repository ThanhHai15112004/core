import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { ModuleRef } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  DatabaseConnectionService,
  TypeOrmConfigService,
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

describe('DatabaseConnectionService & TypeOrmConfigService', () => {
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
    return new DatabaseConnectionService(moduleRef, config, redis);
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

  it('ping() bị treo → tự động timeout với mã lỗi ETIMEOUT thay vì treo vô hạn', async () => {
    applyTestEnv({ DB_CONNECT_TIMEOUT_MS: '1200' });
    config = new CoreConfigService();
    const { ds } = fakeDataSource(0);
    const svc = create(ds);
    svc.onApplicationBootstrap();
    await advance(0);
    expect(svc.isConnected()).toBe(true);

    (ds as unknown as { query: () => Promise<unknown> }).query = () => new Promise(() => undefined);
    const pingPromise = svc.ping();
    await advance(1200);
    const result = await pingPromise;
    expect(result).toMatchObject({
      ok: false,
      latencyMs: null,
      error: { code: 'ETIMEOUT' },
    });
    await svc.onApplicationShutdown();
    applyTestEnv({ DB_CONNECT_TIMEOUT_MS: '10000' });
  });

  it('áp dụng queryTimeoutMs cho MySQL pool độc lập với slowQueryMs', async () => {
    applyTestEnv({ DB_QUERY_TIMEOUT_MS: '15000', DB_SLOW_QUERY_MS: '500' });
    config = new CoreConfigService();

    const executed: unknown[] = [];
    const existingConn = {
      query: (sql: unknown) => {
        executed.push(sql);
      },
    };
    let onConnectionListener: ((conn: typeof existingConn) => void) | undefined;

    let initialized = false;
    const ds = {
      options: { type: 'mysql' },
      get isInitialized() {
        return initialized;
      },
      driver: {
        pool: {
          _allConnections: [existingConn],
          on: (event: string, cb: (conn: typeof existingConn) => void) => {
            if (event === 'connection') onConnectionListener = cb;
          },
        },
      },
      initialize: async () => {
        initialized = true;
      },
      query: async () => [{ 1: 1 }],
    } as unknown as DataSource;

    const svc = create(ds);
    svc.onApplicationBootstrap();
    await advance(0);

    expect(executed[0]).toBe('SET SESSION max_execution_time = 15000');
    existingConn.query('SELECT * FROM users');
    expect(executed[1]).toEqual({ sql: 'SELECT * FROM users', timeout: 15000 });

    const newConnExecuted: unknown[] = [];
    const newConn = {
      query: (sql: unknown) => {
        newConnExecuted.push(sql);
      },
    };
    onConnectionListener?.(newConn);
    newConn.query('UPDATE users SET active = 1');
    expect(newConnExecuted).toEqual([
      'SET SESSION max_execution_time = 15000',
      { sql: 'UPDATE users SET active = 1', timeout: 15000 },
    ]);

    await svc.onApplicationShutdown();
    applyTestEnv({ DB_QUERY_TIMEOUT_MS: '30000' });
  });

  it('TypeOrmConfigService tạo cấu hình pool và queryTimeout chuẩn cho MySQL, Postgres, MSSQL', () => {
    const sharedEnv = {
      DB_MAX_CONNECTIONS: '20',
      DB_POOL_MAX_IDLE: '8',
      DB_POOL_IDLE_TIMEOUT_MS: '45000',
      DB_POOL_QUEUE_LIMIT: '100',
      DB_CONNECT_TIMEOUT_MS: '8000',
      DB_QUERY_TIMEOUT_MS: '25000',
      DB_SLOW_QUERY_MS: '600',
    };
    applyTestEnv({ ...sharedEnv, DB_CONNECTION: 'mysql' });
    const mysqlOpts = new TypeOrmConfigService(
      new CoreConfigService(),
    ).createTypeOrmOptions() as Record<string, unknown>;
    expect(mysqlOpts).toMatchObject({
      type: 'mysql',
      maxQueryExecutionTime: 600,
      connectTimeout: 8000,
      extra: {
        connectionLimit: 20,
        maxIdle: 8,
        idleTimeout: 45000,
        queueLimit: 100,
      },
    });

    applyTestEnv({ ...sharedEnv, DB_CONNECTION: 'pgsql' });
    const pgOpts = new TypeOrmConfigService(
      new CoreConfigService(),
    ).createTypeOrmOptions() as Record<string, unknown>;
    expect(pgOpts).toMatchObject({
      type: 'postgres',
      maxQueryExecutionTime: 600,
      connectTimeoutMS: 8000,
      extra: {
        max: 20,
        idleTimeoutMillis: 45000,
        statement_timeout: 25000,
        query_timeout: 25000,
      },
    });

    applyTestEnv({ ...sharedEnv, DB_CONNECTION: 'mssql' });
    const mssqlOpts = new TypeOrmConfigService(
      new CoreConfigService(),
    ).createTypeOrmOptions() as Record<string, unknown>;
    expect(mssqlOpts).toMatchObject({
      type: 'mssql',
      maxQueryExecutionTime: 600,
      connectionTimeout: 8000,
      requestTimeout: 25000,
      extra: {
        pool: {
          max: 20,
          idleTimeoutMillis: 45000,
        },
      },
    });

    applyTestEnv();
  });
});
