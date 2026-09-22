import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  BaseCacheProvider,
  CacheConnectionService,
  CacheMonitoringService,
  CacheOperationError,
  CacheOperationsService,
  cacheKeys,
} from '@packages/cache/index.js';
import {
  diffCacheAlerts,
  evaluateCacheRules,
  type CacheRuleInput,
} from '@modules/cache-ops/index.js';

const ctx = { ip: '10.0.0.x', actor: null };

describe('CacheOperationsService', () => {
  let redis: RedisService;
  let cache: BaseCacheProvider;

  const build = (env: Record<string, string> = {}) => {
    applyTestEnv({
      CACHE_DRIVER: 'redis',
      OPS_CACHE_ACTIONS_ENABLED: 'true',
      OPS_CACHE_FLUSH_ENABLED: 'true',
      ...env,
    });
    const config = new CoreConfigService();
    cache = new BaseCacheProvider(config, redis);
    const connection = new CacheConnectionService(cache, redis);
    connection.onApplicationBootstrap();
    const monitoring = new CacheMonitoringService(cache, connection, config, redis);
    return new CacheOperationsService(cache, connection, monitoring, config, redis);
  };

  afterAll(() => {
    // process.env dùng chung giữa các file test (runInBand).
    for (const k of ['CACHE_DRIVER', 'OPS_CACHE_ACTIONS_ENABLED', 'OPS_CACHE_FLUSH_ENABLED'])
      delete process.env[k];
  });

  beforeEach(async () => {
    applyTestEnv();
    redis = new RedisService(new CoreConfigService(), mockRedisFactory);
    await redis.client.flushall();
  });

  it('xoá key: ghi audit + sự kiện; key không tồn tại → KEY_NOT_FOUND', async () => {
    const ops = build();
    await cache.set('user:1', 1);
    const { record } = await ops.deleteKey('user:1', ctx);
    expect(record).toMatchObject({
      action: 'delete_key',
      target: 'user:1',
      result: 'success',
      affected: 1,
      ip: '10.0.0.x',
    });
    expect(await redis.client.exists('core_test:cache:user:1')).toBe(0);
    const audit = await redis.client.lrange(cacheKeys(redis).operations(), 0, -1);
    expect(audit).toHaveLength(1);
    const events = await redis.client.lrange(cacheKeys(redis).events(), 0, -1);
    expect(JSON.parse(events[0]!)).toMatchObject({ type: 'key_deleted' });
    await expect(ops.deleteKey('user:1', ctx)).rejects.toMatchObject({ code: 'KEY_NOT_FOUND' });
  });

  it('clear namespace chỉ xoá đúng namespace (không xoá namespace con/khác)', async () => {
    const ops = build();
    await cache.set('data:users:1', 1);
    await cache.set('data:users:2', 2);
    await cache.set('data:courses:1', 3);
    await cache.set('user:1', 4);
    const { record } = await ops.clearNamespace('data:users', ctx);
    expect(record.affected).toBe(2);
    expect(await cache.get('data:courses:1')).toBe(3);
    expect(await cache.get('user:1')).toBe(4);
    await expect(ops.clearNamespace('data:users', ctx)).rejects.toMatchObject({
      code: 'NAMESPACE_EMPTY',
    });
  });

  it('flush giữ nguyên dữ liệu vận hành (cachemon) và key ngoài cache', async () => {
    const ops = build();
    await cache.set('a:1', 1);
    await redis.client.set('core_test:runtime:hb:api', 'x');
    const { record } = await ops.flushAll(ctx);
    expect(record.affected).toBe(1);
    expect(await redis.client.exists('core_test:runtime:hb:api')).toBe(1);
    expect(await redis.client.llen(cacheKeys(redis).operations())).toBe(1);
  });

  it('bị chặn khi tắt bằng env hoặc đang có thao tác khác', async () => {
    const off = build({ OPS_CACHE_ACTIONS_ENABLED: 'false', OPS_CACHE_FLUSH_ENABLED: 'false' });
    await expect(off.deleteKey('a:1', ctx)).rejects.toBeInstanceOf(CacheOperationError);
    await expect(off.flushAll(ctx)).rejects.toMatchObject({ code: 'FLUSH_DISABLED' });
    const ops = build();
    await redis.client.set(cacheKeys(redis).flushLock(), 'other');
    await expect(ops.flushAll(ctx)).rejects.toMatchObject({ code: 'BUSY' });
  });
});

describe('evaluateCacheRules', () => {
  const cfg = new CoreConfigService().cache.rules;
  const base: CacheRuleInput = {
    connection: 'connected',
    hitRate: { current: 95, baseline: 96, reads: 1000 },
    missRate: { current: 5, baseline: 4 },
    dbQps: { current: null, baseline: null },
    namespaces: [],
    memory: { percent: 30 },
    evictionsPerMin: 0,
    rejectedDelta: 0,
    connections: { used: 10, max: 10000 },
    expiringNext60s: 0,
    largestKey: null,
    persistent: null,
  };

  it('bình thường → không cảnh báo', () => {
    expect(evaluateCacheRules(base, cfg)).toEqual([]);
  });

  it('mất kết nối → chỉ CACHE_UNAVAILABLE', () => {
    expect(
      evaluateCacheRules({ ...base, connection: 'reconnecting' }, cfg).map((v) => v.id),
    ).toEqual(['CACHE_UNAVAILABLE']);
  });

  it('hit rate thấp, miss tăng kèm DB tăng, namespace, bộ nhớ, eviction, key lớn', () => {
    const v = evaluateCacheRules(
      {
        ...base,
        hitRate: { current: 52, baseline: 95, reads: 500 },
        missRate: { current: 48, baseline: 5 },
        dbQps: { current: 30, baseline: 10 },
        namespaces: [{ name: 'data:products', hitRate: 40, reads: 200 }],
        memory: { percent: 92 },
        evictionsPerMin: 428,
        expiringNext60s: 5000,
        largestKey: { key: 'report:monthly', bytes: 8 * 1024 * 1024 },
        persistent: { keys: 12, topNamespace: 'legacy' },
      },
      cfg,
    );
    const byId = Object.fromEntries(v.map((x) => [x.id, x]));
    expect(byId['HIT_RATE_LOW']!.severity).toBe('critical');
    expect(byId['MISS_STORM']).toMatchObject({ severity: 'critical', extra: { dbChange: 200 } });
    expect(byId['NAMESPACE_HIT_RATE_LOW:data:products']!.namespace).toBe('data:products');
    expect(byId['MEMORY_PRESSURE']!.severity).toBe('critical');
    expect(byId['EVICTIONS']!.severity).toBe('critical');
    expect(byId['EXPIRY_SPIKE']).toBeDefined();
    expect(byId['LARGE_KEY']!.extra['key']).toBe('report:monthly');
    expect(byId['PERSISTENT_KEYS']!.severity).toBe('info');
    expect(v.at(-1)!.severity).toBe('info');
  });

  it('không đủ lượt đọc → không kết luận hit rate', () => {
    const v = evaluateCacheRules(
      { ...base, hitRate: { current: 10, baseline: 90, reads: 3 } },
      cfg,
    );
    expect(v.find((x) => x.rule === 'HIT_RATE_LOW')).toBeUndefined();
  });

  it('diff: bắt đầu / hồi phục', () => {
    const [violation] = evaluateCacheRules({ ...base, evictionsPerMin: 5 }, cfg);
    const first = diffCacheAlerts([violation!], new Map(), 1000);
    expect(first.started).toHaveLength(1);
    const later = diffCacheAlerts([], first.set, 61_000);
    expect(later.recovered[0]).toMatchObject({ id: 'EVICTIONS', durationMs: 60_000 });
  });
});
