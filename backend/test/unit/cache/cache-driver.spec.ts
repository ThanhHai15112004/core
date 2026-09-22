import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  BaseCacheProvider,
  MemoryCacheDriver,
  cacheKeys,
  isIdLike,
  matchesNamespace,
  namespaceOf,
  namespacePattern,
  unlinkMatching,
} from '@packages/cache/index.js';

describe('namespaceOf', () => {
  it.each([
    ['user:8291', 'user'],
    ['data:users:12', 'data:users'],
    ['auth:session:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b', 'auth:session'],
    ['rate-limit:10.0.0.1', 'rate-limit'],
    ['config', '(root)'],
    ['report:2026-09-22:daily', 'report'],
    ['a:b:c:d', 'a:b'],
  ])('%s → %s', (key, ns) => {
    expect(namespaceOf(key, 2)).toBe(ns);
  });

  it('nhận biết segment kiểu định danh', () => {
    expect(isIdLike('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isIdLike('alice@example.com')).toBe(true);
    expect(isIdLike('users')).toBe(false);
  });

  it('pattern SCAN escape ký tự glob và khớp namespace cấu hình', () => {
    expect(namespacePattern('core:cache:', 'data:users')).toBe('core:cache:data:users:*');
    expect(namespacePattern('core:cache:', 'a*b')).toBe('core:cache:a\\*b:*');
    expect(matchesNamespace('auth:session', ['session'])).toBe(true);
    expect(matchesNamespace('data:users', ['session'])).toBe(false);
  });
});

afterAll(() => {
  delete process.env['CACHE_DRIVER'];
  delete process.env['CACHE_DEFAULT_TTL_SEC'];
});

describe('BaseCacheProvider (driver redis, ioredis-mock)', () => {
  let redis: RedisService;
  let cache: BaseCacheProvider;

  beforeEach(async () => {
    applyTestEnv({ CACHE_DRIVER: 'redis', CACHE_DEFAULT_TTL_SEC: '0' });
    const config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    cache = new BaseCacheProvider(config, redis);
  });

  it('lưu JSON dưới <prefix>cache:, có TTL, đếm hit/miss', async () => {
    await cache.set('user:1', { name: 'A' }, 60);
    await cache.set('config', true);
    expect(await cache.get('user:1')).toEqual({ name: 'A' });
    expect(await cache.get('user:2')).toBeNull();
    expect(await redis.client.get('core_test:cache:user:1')).toBe('{"name":"A"}');
    expect(await redis.client.pttl('core_test:cache:user:1')).toBeGreaterThan(59_000);
    expect(await redis.client.pttl('core_test:cache:config')).toBe(-1);
    expect(cache.getStats()).toMatchObject({ hits: 1, misses: 1, hitRatePercent: 50 });
  });

  it('Redis chưa sẵn sàng → đọc là miss, ghi bỏ qua, không ném lỗi', async () => {
    Object.defineProperty(redis.client, 'status', { value: 'reconnecting', configurable: true });
    await expect(cache.set('user:1', 1)).resolves.toBeUndefined();
    expect(await cache.get('user:1')).toBeNull();
    expect(cache.getStats().misses).toBe(1);
  });

  it('flush chỉ xoá vùng cache của core, không đụng telemetry hay key project khác', async () => {
    await cache.set('user:1', 1);
    await cache.set('data:users:2', 2);
    await redis.client.set('core_test:perf:b:s10:1:api', 'x');
    await redis.client.set('core_test:cachemon:events', 'y');
    await redis.client.set('coaching:session:1', 'z');
    expect(await cache.flush()).toBe(2);
    expect(await redis.client.keys('*')).toEqual(
      expect.arrayContaining([
        'core_test:perf:b:s10:1:api',
        'core_test:cachemon:events',
        'coaching:session:1',
      ]),
    );
    expect(await redis.client.exists('core_test:cache:user:1')).toBe(0);
  });

  it('unlinkMatching bỏ qua key ngoài vùng cache dù pattern rộng', async () => {
    await redis.client.set('core_test:cache:a:1', '1');
    await redis.client.set('core_test:other', '1');
    expect(await unlinkMatching(redis, 'core_test:*')).toBe(1);
    expect(await redis.client.exists('core_test:other')).toBe(1);
    expect(cacheKeys(redis).dataPrefix()).toBe('core_test:cache:');
  });
});

describe('BaseCacheProvider (driver memory)', () => {
  it('Map riêng của process, hết hạn theo TTL', async () => {
    applyTestEnv({ CACHE_DRIVER: 'memory' });
    const cache = new BaseCacheProvider(new CoreConfigService());
    expect(cache.driver).toBeInstanceOf(MemoryCacheDriver);
    await cache.set('a:1', 'x', 0.001);
    await cache.set('b:1', 'y');
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.get('a:1')).toBeNull();
    expect(await cache.get('b:1')).toBe('y');
    expect(cache.getStats().keys).toBe(1);
  });
});
