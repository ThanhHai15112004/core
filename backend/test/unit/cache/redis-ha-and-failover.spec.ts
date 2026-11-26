import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import type { Cluster, ClusterNode, ClusterOptions, Redis, RedisOptions } from 'ioredis';
import type { ModuleRef } from '@nestjs/core';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { CoreConfigService } from '@packages/config/index.js';
import {
  RedisService,
  buildRetryStrategy,
  shouldReconnectOnRedisError,
  type RedisClientFactory,
  type RedisClusterFactory,
} from '@packages/redis/index.js';
import {
  BaseCacheProvider,
  CacheConnectionService,
  DistributedLockService,
  HotKeyTracker,
  aggregateClusterServerInfo,
  cacheKeys,
} from '@packages/cache/index.js';
import { QueueRegistry } from '@packages/messaging/index.js';
import { evaluateCacheRules } from '@modules/cache-ops/services/cache-rules.js';
import { SessionService } from '@modules/sessions/services/session.service.js';
import type { AuthSessionRepository } from '@modules/sessions/repositories/auth-session.repository.js';
import type { PasswordHasherService, TokenService } from '@packages/security/index.js';

const EXTRA_ENV_KEYS = [
  'REDIS_MODE',
  'REDIS_SENTINELS',
  'REDIS_SENTINEL_MASTER_NAME',
  'REDIS_SENTINEL_PASSWORD',
  'REDIS_SENTINEL_ROLE',
  'REDIS_CLUSTER_NODES',
  'REDIS_CLUSTER_SCALE_READS',
  'REDIS_CLUSTER_SLOTS_REFRESH_TIMEOUT_MS',
  'REDIS_CLUSTER_SLOTS_REFRESH_INTERVAL_MS',
  'REDIS_CONNECT_TIMEOUT_MS',
  'REDIS_COMMAND_TIMEOUT_MS',
  'REDIS_KEEP_ALIVE_MS',
  'REDIS_MAX_RETRIES_PER_REQUEST',
  'REDIS_RETRY_BASE_DELAY_MS',
  'REDIS_RETRY_MAX_DELAY_MS',
  'REDIS_MAX_RECONNECT_ATTEMPTS',
  'REDIS_LOCK_ALLOW_MEMORY_FALLBACK',
  'CACHE_DRIVER',
  'CACHE_DEGRADED_FAILURE_THRESHOLD',
  'CACHE_DEGRADED_COOLDOWN_MS',
  'CACHE_HOT_KEY_WINDOW_SEC',
  'CACHE_HOT_KEY_WARN_RPM',
  'CACHE_EVICTION_CRIT_PER_MIN',
];

function resetEnv(overrides?: Partial<Record<string, string>>): void {
  for (const key of EXTRA_ENV_KEYS) {
    delete process.env[key];
  }
  applyTestEnv(overrides);
}

/** Tạo mock Redis client có thể đổi status/endpoint và phát sự kiện failover/reconnect. */
function createControllableRedis(initialHost = '10.0.0.1', initialPort = 6379) {
  const raw = new RedisMock({ lazyConnect: true }) as unknown as Redis &
    EventEmitter & {
      status: string;
      options: RedisOptions;
    };
  let status = 'ready';
  Object.defineProperty(raw, 'status', {
    get: () => status,
    set: (next: string) => {
      status = next;
    },
    configurable: true,
  });
  raw.options = { ...(raw.options ?? {}), host: initialHost, port: initialPort };
  raw.connect = async () => undefined;
  raw.quit = async () => 'OK';
  return {
    client: raw,
    setStatus(next: string) {
      status = next;
    },
    setPrimary(host: string, port: number) {
      raw.options = { ...(raw.options ?? {}), host, port };
    },
  };
}

describe('Phase 13.4 — Redis High Availability (Sentinel, Cluster, Reconnect, Degraded, Hot/Large Key & Failover Drill)', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterAll(() => {
    resetEnv();
  });

  it('13.4.1: Hỗ trợ cấu hình Redis Sentinel và fail-fast khi thiếu endpoint/masterName', () => {
    resetEnv({ REDIS_MODE: 'sentinel' });
    expect(() => new CoreConfigService()).toThrow(/REDIS_SENTINELS/);

    resetEnv({
      REDIS_MODE: 'sentinel',
      REDIS_SENTINELS: '10.0.1.10:26379,10.0.1.11:26379',
      REDIS_SENTINEL_MASTER_NAME: 'core-master',
      REDIS_SENTINEL_PASSWORD: 'sentinel-secret',
      REDIS_SENTINEL_ROLE: 'master',
      REDIS_CONNECT_TIMEOUT_MS: '2500',
      REDIS_COMMAND_TIMEOUT_MS: '1500',
      REDIS_MAX_RETRIES_PER_REQUEST: '2',
    });

    const config = new CoreConfigService();
    let capturedOptions: RedisOptions | null = null;
    const controllable = createControllableRedis('10.0.1.10', 6379);
    const factory: RedisClientFactory = (opts) => {
      capturedOptions = opts;
      return controllable.client;
    };

    const redis = new RedisService(config, factory, { id: 'api' });
    expect(redis.mode).toBe('sentinel');
    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions!.sentinels).toEqual([
      { host: '10.0.1.10', port: 26379 },
      { host: '10.0.1.11', port: 26379 },
    ]);
    expect(capturedOptions!.name).toBe('core-master');
    expect(capturedOptions!.sentinelPassword).toBe('sentinel-secret');
    expect(capturedOptions!.failoverDetector).toBe(true);
    expect(capturedOptions!.connectTimeout).toBe(2500);
    expect(capturedOptions!.commandTimeout).toBe(1500);
    expect(capturedOptions!.maxRetriesPerRequest).toBe(2);
    expect(typeof capturedOptions!.sentinelRetryStrategy).toBe('function');

    const bullOpts = redis.bullConnection() as RedisOptions;
    expect(bullOpts.sentinels).toHaveLength(2);
    expect(bullOpts.name).toBe('core-master');
    expect(bullOpts.maxRetriesPerRequest).toBeNull();
    expect(bullOpts.commandTimeout).toBeUndefined();
    expect(redis.bullPrefix()).toBe('core_test:bull');
  });

  it('13.4.2: Hỗ trợ Redis Cluster, hash-tag prefix cho BullMQ và tổng hợp multi-master', async () => {
    resetEnv({ REDIS_MODE: 'cluster' });
    expect(() => new CoreConfigService()).toThrow(/REDIS_CLUSTER_NODES/);

    resetEnv({
      REDIS_MODE: 'cluster',
      REDIS_CLUSTER_NODES: '10.0.2.1:7000,10.0.2.2:7001,10.0.2.3:7002',
      REDIS_CLUSTER_SCALE_READS: 'slave',
      REDIS_CLUSTER_SLOTS_REFRESH_TIMEOUT_MS: '1800',
    });

    const config = new CoreConfigService();
    const nodeA = createControllableRedis('10.0.2.1', 7000).client;
    const nodeB = createControllableRedis('10.0.2.2', 7001).client;
    await nodeA.set('core_test:cache:alpha', '1');
    await nodeB.set('core_test:cache:beta', '2');

    let capturedClusterArgs: { nodes: ClusterNode[]; options: ClusterOptions } | null = null;
    const createMockCluster = (nodes: ClusterNode[], options: ClusterOptions): Cluster => {
      if (!capturedClusterArgs) {
        capturedClusterArgs = { nodes, options };
      }
      const emitter = new EventEmitter() as unknown as Cluster & {
        status: string;
        nodes: (role?: string) => Redis[];
        connect: () => Promise<void>;
        quit: () => Promise<'OK'>;
        ping: () => Promise<string>;
      };
      emitter.status = 'ready';
      emitter.nodes = (role?: string) => (role === 'all' ? [nodeA, nodeB] : [nodeA, nodeB]);
      emitter.connect = async () => undefined;
      emitter.quit = async () => 'OK';
      emitter.ping = async () => 'PONG';
      return emitter;
    };

    const clusterFactory: RedisClusterFactory = (nodes, options) =>
      createMockCluster(nodes, options);
    const redis = new RedisService(config, () => nodeA, { id: 'api' }, clusterFactory);

    expect(redis.mode).toBe('cluster');
    expect(redis.isCluster()).toBe(true);
    expect(redis.db).toBe(0);
    expect(redis.bullPrefix()).toBe('{core_test:bull}');
    expect(capturedClusterArgs!.nodes).toEqual([
      { host: '10.0.2.1', port: 7000 },
      { host: '10.0.2.2', port: 7001 },
      { host: '10.0.2.3', port: 7002 },
    ]);
    expect(capturedClusterArgs!.options.scaleReads).toBe('slave');
    expect(capturedClusterArgs!.options.slotsRefreshTimeout).toBe(1800);

    const ha = redis.getHaStatus();
    expect(ha.clusterNodes).toEqual({ total: 2, masters: 2, readyMasters: 2 });

    // Tổng hợp ServerInfo từ nhiều master nodes trên Cluster
    const aggregated = aggregateClusterServerInfo([
      {
        version: '7.2.4',
        mode: 'cluster',
        uptimeSec: 1200,
        usedMemory: 1000,
        peakMemory: 1500,
        maxMemory: 4000,
        maxMemoryPolicy: 'allkeys-lru',
        fragmentationRatio: 1.1,
        rssMemory: 1200,
        connectedClients: 10,
        maxClients: 1000,
        blockedClients: 1,
        rejectedConnections: 0,
        evictedKeys: 2,
        expiredKeys: 5,
        keyspaceHits: 100,
        keyspaceMisses: 10,
        opsPerSec: 50,
        keyspace: [{ db: 'db0', keys: 12, expires: 4 }],
        currentDb: 0,
      },
      {
        version: '7.2.4',
        mode: 'cluster',
        uptimeSec: 1200,
        usedMemory: 2000,
        peakMemory: 2500,
        maxMemory: 4000,
        maxMemoryPolicy: 'allkeys-lru',
        fragmentationRatio: 1.3,
        rssMemory: 2300,
        connectedClients: 15,
        maxClients: 1000,
        blockedClients: 2,
        rejectedConnections: 1,
        evictedKeys: 3,
        expiredKeys: 7,
        keyspaceHits: 200,
        keyspaceMisses: 20,
        opsPerSec: 70,
        keyspace: [{ db: 'db0', keys: 18, expires: 6 }],
        currentDb: 0,
      },
    ]);
    expect(aggregated.usedMemory).toBe(3000);
    expect(aggregated.maxMemory).toBe(8000);
    expect(aggregated.evictedKeys).toBe(5);
    expect(aggregated.keyspaceHits).toBe(300);
    expect(aggregated.keyspace).toEqual([{ db: 'db0', keys: 30, expires: 10 }]);

    // Kiểm tra BullMQ cluster connection đóng sạch khi shutdown
    const bullCluster = redis.bullConnection();
    expect(bullCluster).toBeDefined();
    await redis.onApplicationShutdown();
  });

  it('13.4.3: Tự kết nối lại khi đổi node (READONLY/CLUSTERDOWN/+switch-master) & cấu hình timeout/retry', () => {
    // reconnectOnError trả về 2 (reconnect & resend command) cho lỗi failover
    expect(
      shouldReconnectOnRedisError(
        new Error("READONLY You can't write against a read only replica."),
      ),
    ).toBe(2);
    expect(shouldReconnectOnRedisError(new Error('CLUSTERDOWN The cluster is down'))).toBe(2);
    expect(
      shouldReconnectOnRedisError(new Error('LOADING Redis is loading the dataset in memory')),
    ).toBe(2);
    expect(
      shouldReconnectOnRedisError(new Error('TRYAGAIN Multiple keys request during rehashing')),
    ).toBe(2);
    expect(
      shouldReconnectOnRedisError(
        new Error('WRONGTYPE Operation against a key holding wrong kind'),
      ),
    ).toBe(false);

    // Retry strategy có trần và giới hạn số lần nếu đặt maxReconnectAttempts
    const bounded = buildRetryStrategy(200, 1000, 3);
    expect(bounded(1)).toBe(200);
    expect(bounded(2)).toBe(400);
    expect(bounded(3)).toBe(600);
    expect(bounded(4)).toBeNull();

    resetEnv({
      REDIS_MODE: 'sentinel',
      REDIS_SENTINELS: '10.0.1.1:26379',
      REDIS_SENTINEL_MASTER_NAME: 'mymaster',
    });
    const config = new CoreConfigService();
    const node = createControllableRedis('10.0.1.10', 6379);
    const redis = new RedisService(config, () => node.client, { id: 'api' });

    const events: string[] = [];
    redis.onFailover((e) => events.push(`${e.reason}:${e.currentPrimary ?? ''}`));

    node.client.emit('ready');
    expect(redis.getHaStatus().currentPrimary).toBe('10.0.1.10:6379');

    // Mô phỏng mất kết nối → reconnect → bầu Primary mới
    node.setStatus('reconnecting');
    node.client.emit('reconnecting');
    node.setPrimary('10.0.1.11', 6379);
    node.client.emit('+switch-master', 'mymaster', '10.0.1.10', 6379, '10.0.1.11', 6379);
    node.setStatus('ready');
    node.client.emit('ready');

    const status = redis.getHaStatus();
    expect(status.reconnectCount).toBe(1);
    expect(status.failoverCount).toBe(1);
    expect(status.currentPrimary).toBe('10.0.1.11:6379');
    expect(status.lastFailoverAt).not.toBeNull();
    expect(events).toContain('sentinel_switch_master:10.0.1.11:6379');
  });

  it('13.4.4: Theo dõi Hot Key, Large Key, Memory & Eviction rules', () => {
    const tracker = new HotKeyTracker({
      windowSec: 60,
      warnRpm: 10,
      maxTrackedKeys: 100,
      depth: 2,
    });

    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 20; i++) tracker.record('catalog:featured', 'get', t0 + i * 100);
    for (let i = 0; i < 4; i++) tracker.record('users:detail:1', 'get', t0 + i * 100);

    const snap = tracker.snapshot(10, t0 + 3000);
    expect(snap.totalAccesses).toBe(24);
    expect(snap.items[0]).toMatchObject({
      key: 'catalog:featured',
      namespace: 'catalog',
      hits: 20,
      rpm: 20,
      hot: true,
    });
    expect(snap.items[0]!.sharePercent).toBeCloseTo(83.3, 1);
    expect(snap.items[1]!.hot).toBe(false);

    const config = new CoreConfigService();
    const violations = evaluateCacheRules(
      {
        connection: 'connected',
        hitRate: { current: 95, baseline: 96, reads: 200 },
        missRate: { current: 5, baseline: 4 },
        memory: { percent: 92 },
        evictionsPerMin: 120,
        rejectedDelta: 0,
        connections: { used: 10, max: 100 },
        expiringNext60s: 10,
        largestKey: { key: 'report:big', bytes: 2 * 1024 * 1024 },
        hotKey: { key: 'catalog:featured', rpm: 150, sharePercent: 83.3 },
        ha: { mode: 'cluster', degraded: true, clusterReadyMasters: 2, clusterMasters: 3 },
        persistent: null,
      },
      config.cache.rules,
    );

    const byRule = Object.fromEntries(violations.map((v) => [v.rule, v]));
    expect(byRule['MEMORY_PRESSURE']?.severity).toBe('critical');
    expect(byRule['EVICTIONS']?.severity).toBe('critical');
    expect(byRule['LARGE_KEY']?.severity).toBe('warning');
    expect(byRule['HOT_KEY']?.severity).toBe('warning');
    expect(byRule['REDIS_HA_DEGRADED']?.severity).toBe('warning');
  });

  it('13.4.5: Kịch bản kiểm tra Failover toàn diện — Session, Queue, Cache & Distributed Lock', async () => {
    resetEnv({
      NODE_ENV: 'production',
      CACHE_DRIVER: 'redis',
      STORAGE_DRIVER: 's3',
      CACHE_DEGRADED_FAILURE_THRESHOLD: '2',
      CACHE_DEGRADED_COOLDOWN_MS: '10000',
    });
    const config = new CoreConfigService();
    const node = createControllableRedis('10.0.3.10', 6379);
    const redis = new RedisService(config, () => node.client, { id: 'api' });

    const cache = new BaseCacheProvider(config, redis, { id: 'api', kind: 'long-running' });
    const connection = new CacheConnectionService(cache, redis, {
      id: 'api',
      kind: 'long-running',
    });
    connection.onApplicationBootstrap();
    node.client.emit('ready');
    const lockService = new DistributedLockService(config, redis);

    // 1) Trước failover: mọi thành phần hoạt động bình thường trên Primary cũ
    await cache.set('profile:1', { name: 'Initial' }, 60);
    expect(await cache.get('profile:1')).toEqual({ name: 'Initial' });

    const lockBefore = await lockService.acquire('settlement:batch-1', {
      ttlMs: 10_000,
      ownerToken: 'worker-a',
    });
    expect(lockBefore).not.toBeNull();
    await lockBefore!.release();

    // Thiết lập SessionService mock repository để kiểm tra fallback DB khi Redis sập
    let sessionRevokedInDb = false;
    const fakeSessionRepo = {
      findById: jest.fn(async (id: number) => ({
        id,
        userId: 42,
        createdAt: new Date(Date.now() - 60_000),
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
        revokedAt: sessionRevokedInDb ? new Date() : null,
      })),
      saveEntity: jest.fn(async (s: unknown) => s),
    } as unknown as AuthSessionRepository;

    const sessionService = new SessionService(
      fakeSessionRepo,
      {} as TokenService,
      {} as PasswordHasherService,
      config,
      redis,
    );
    expect(await sessionService.isSessionActive(101, 42)).toBe(true);

    // Thiết lập QueueRegistry để kiểm tra fail-fast timeout khi Redis mất kết nối
    const queueReg = new QueueRegistry({} as ModuleRef, config);

    // ── MÔ PHỎNG FAILOVER: Primary cũ chết, kết nối gián đoạn / lỗi timeout ───────────
    node.setStatus('reconnecting');
    node.client.emit('close');
    node.client.emit('reconnecting');
    expect(connection.getStatus().state).toBe('reconnecting');

    const origGet = node.client.get.bind(node.client);
    node.client.get = (() => Promise.reject(new Error('ETIMEDOUT: connection timed out'))) as never;

    // A. Cache: Failover -> mở degraded circuit và phục vụ bình thường từ nguồn chính
    let dbCalls = 0;
    const val1 = await cache.getOrSet('profile:1', async () => {
      dbCalls++;
      return { name: 'FromDBDuringOutage' };
    });
    expect(val1).toEqual({ name: 'FromDBDuringOutage' });
    expect(dbCalls).toBe(1);

    // Lỗi liên tiếp đạt ngưỡng 2 -> kích hoạt bypass ngay lập tức không chờ Redis
    await cache.get('profile:2');
    await cache.get('profile:3');
    const degradedBeforeRecovery = cache.getDegradedStatus();
    expect(degradedBeforeRecovery.degraded).toBe(true);
    expect(degradedBeforeRecovery.bypassedCount).toBeGreaterThanOrEqual(1);

    // B. Session: Redis down -> fallback DB chính xác (không sập, vẫn chặn session đã revoke trong DB)
    expect(await sessionService.isSessionActive(101, 42)).toBe(true);
    sessionRevokedInDb = true;
    expect(await sessionService.isSessionActive(101, 42)).toBe(false);

    // C. Queue: không treo vô hạn khi broker mất kết nối (fail-fast theo timeout)
    await expect(queueReg.withTimeout(new Promise(() => undefined), 30)).rejects.toThrow(
      /timed out/i,
    );

    // D. Distributed Lock: fail-closed khi Redis mất kết nối (cấm fallback RAM gây split-brain)
    const lockDuringOutage = await lockService.acquire('settlement:batch-1', {
      ttlMs: 5000,
      ownerToken: 'worker-b',
    });
    expect(lockDuringOutage).toBeNull();

    // ── PHỤC HỒI SAU FAILOVER: Primary mới sẵn sàng ───────────────────────────────
    node.client.get = origGet;
    node.setPrimary('10.0.3.11', 6379);
    node.setStatus('ready');
    node.client.emit('ready');

    // Chờ async event recording hoàn tất
    await new Promise((r) => setTimeout(r, 20));

    // A. Cache tự đóng mạch degraded và hoạt động bình thường trên Primary mới
    expect(cache.getDegradedStatus().degraded).toBe(false);
    await cache.set('profile:after', { ok: true }, 60);
    expect(await cache.get('profile:after')).toEqual({ ok: true });

    // Kiểm tra sự kiện failover & recovery được ghi vào Redis
    const rawEvents = await node.client.lrange(cacheKeys(redis).events(), 0, 10);
    const eventTypes = rawEvents.map((raw) => (JSON.parse(raw) as { type: string }).type);
    expect(eventTypes).toContain('connection_recovered');
    expect(eventTypes).toContain('failover_detected');

    // B. Session tiếp tục đồng bộ cache bình thường
    sessionRevokedInDb = false;
    expect(await sessionService.isSessionActive(102, 42)).toBe(true);

    // C. Queue hoạt động lại sau failover
    await expect(queueReg.withTimeout(Promise.resolve('PONG'), 100)).resolves.toBe('PONG');

    // D. Distributed Lock hoạt động lại và bảo vệ owner token trên Primary mới
    const lockAfter = await lockService.acquire('settlement:batch-1', {
      ttlMs: 5000,
      ownerToken: 'worker-c',
    });
    expect(lockAfter).not.toBeNull();
    expect(await lockAfter!.extend(8000)).toBe(true);
    expect(await lockAfter!.release()).toBe(true);

    cache.onModuleDestroy();
    connection.onModuleDestroy();
  });
});
