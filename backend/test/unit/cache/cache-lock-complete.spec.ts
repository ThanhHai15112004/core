import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  BaseCacheProvider,
  CacheConnectionService,
  CacheMonitoringService,
  DistributedLockConflictError,
  DistributedLockService,
  MemoryCacheDriver,
  RedisCacheDriver,
  buildStandardCacheKey,
  cacheKeys,
  parseStandardCacheKey,
} from '@packages/cache/index.js';
import { RedisManageableAdapter } from '@packages/redis/index.js';

describe('Phase 7.5 — Bộ nhớ đệm và khóa phân tán (Cache & Lock: Adapter, Key Standard, TTL, Invalidation, Stampede Protection, Distributed Lock, Lock Expiry & Redis Monitoring)', () => {
  let redis: RedisService;
  let config: CoreConfigService;

  beforeEach(async () => {
    applyTestEnv({
      APP_NAME: 'CorePlatform',
      NODE_ENV: 'production',
      CACHE_DRIVER: 'redis',
      CACHE_DEFAULT_TTL_SEC: '300',
    });
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
  });

  afterAll(() => {
    delete process.env['CACHE_DRIVER'];
    delete process.env['CACHE_DEFAULT_TTL_SEC'];
    applyTestEnv();
  });

  it('7.5.1: Tạo Cache Adapter — dùng Redis ở Production và tự động dùng Memory ở Test', async () => {
    // 1. Môi trường Production → dùng RedisCacheDriver
    applyTestEnv({ NODE_ENV: 'production', CACHE_DRIVER: 'redis' });
    const prodConfig = new CoreConfigService();
    const prodCache = BaseCacheProvider.createForEnvironment(prodConfig, redis);
    expect(prodCache.driver).toBeInstanceOf(RedisCacheDriver);
    expect(prodCache.driver.name).toBe('redis');

    await prodCache.set('users:profile:10', { id: 10, role: 'admin' }, 60);
    expect(await prodCache.get('users:profile:10')).toEqual({ id: 10, role: 'admin' });
    expect(await redis.client.get('core_test:cache:users:profile:10')).toBe(
      '{"id":10,"role":"admin"}',
    );

    // 2. Môi trường Test → tự động chọn MemoryCacheDriver tách biệt trong RAM
    applyTestEnv({ NODE_ENV: 'test' });
    const testConfig = new CoreConfigService();
    const testCache = BaseCacheProvider.createForEnvironment(testConfig, redis);
    expect(testCache.driver).toBeInstanceOf(MemoryCacheDriver);
    expect(testCache.driver.name).toBe('memory');

    await testCache.set('users:profile:20', { id: 20, role: 'tester' }, 60);
    expect(await testCache.get('users:profile:20')).toEqual({ id: 20, role: 'tester' });
    expect(await redis.client.get('core_test:cache:users:profile:20')).toBeNull();
  });

  it('7.5.2: Chuẩn hóa tên Cache Key — có đầy đủ project, environment và module', () => {
    const cache = new BaseCacheProvider(config, redis);

    // Tạo key chuẩn từ cấu hình ứng dụng hiện hành (APP_NAME=CorePlatform, NODE_ENV=production)
    const key1 = cache.buildKey('users', 'profile:42');
    expect(key1).toBe('coreplatform:production:users:profile:42');

    // Tự động loại bỏ tiền tố module bị lặp và chuẩn hóa chữ thường
    const key2 = cache.buildKey('Organizations', 'organizations:tree:root');
    expect(key2).toBe('coreplatform:production:organizations:tree:root');

    // Gọi một lần nữa trên key đã chuẩn hóa sẽ giữ nguyên (idempotent)
    expect(cache.buildKey('organizations', key2)).toBe(key2);

    // Hỗ trợ hàm độc lập buildStandardCacheKey & parseStandardCacheKey
    const customKey = buildStandardCacheKey({
      project: 'Lms Enterprise',
      environment: 'staging',
      module: 'Courses',
      key: 'catalog:featured',
    });
    expect(customKey).toBe('lms_enterprise:staging:courses:catalog:featured');

    const parsed = parseStandardCacheKey(customKey);
    expect(parsed).toEqual({
      project: 'lms_enterprise',
      environment: 'staging',
      module: 'courses',
      key: 'catalog:featured',
    });
  });

  it('7.5.3: Thiết lập thời gian hết hạn (TTL) — không giữ dữ liệu cũ quá lâu', async () => {
    // 1. Kiểm tra áp dụng TTL mặc định (300s) và TTL tùy chỉnh trên Redis
    const redisCache = new BaseCacheProvider(config, redis);
    const defaultTtlKey = redisCache.buildKey('settings', 'global_theme');
    const customTtlKey = redisCache.buildKey('auth', 'otp:999');

    await redisCache.set(defaultTtlKey, { dark: true });
    await redisCache.set(customTtlKey, '654321', 30);

    const defaultPttl = await redis.client.pttl(cacheKeys(redis).data(defaultTtlKey));
    const customPttl = await redis.client.pttl(cacheKeys(redis).data(customTtlKey));
    expect(defaultPttl).toBeGreaterThan(290_000);
    expect(defaultPttl).toBeLessThanOrEqual(300_000);
    expect(customPttl).toBeGreaterThan(25_000);
    expect(customPttl).toBeLessThanOrEqual(30_000);

    // 2. Kiểm tra dữ liệu tự động biến mất sau khi hết hạn
    applyTestEnv({ NODE_ENV: 'test', CACHE_DRIVER: 'memory' });
    const memCache = new BaseCacheProvider(new CoreConfigService());
    await memCache.set('short:lived', { ok: true }, 0.02);
    expect(await memCache.get('short:lived')).toEqual({ ok: true });

    await new Promise((r) => setTimeout(r, 35));
    expect(await memCache.get('short:lived')).toBeNull();
    expect(await memCache.has('short:lived')).toBe(false);
  });

  it('7.5.4: Xóa cache khi dữ liệu thay đổi — hỗ trợ xóa đơn lẻ, xóa theo prefix và xóa theo module trên cả Redis & Memory', async () => {
    const redisCache = new BaseCacheProvider(config, redis);

    const u1 = redisCache.buildKey('users', 'detail:1');
    const u2 = redisCache.buildKey('users', 'detail:2');
    const uList = 'users:list:page:1';
    const r1 = redisCache.buildKey('roles', 'permissions:admin');

    await redisCache.set(u1, { id: 1, name: 'Old Name 1' });
    await redisCache.set(u2, { id: 2, name: 'Old Name 2' });
    await redisCache.set(uList, [{ id: 1 }, { id: 2 }]);
    await redisCache.set(r1, ['users.view', 'users.edit']);

    // 1. Xóa 1 key khi bản ghi đơn lẻ thay đổi
    await redisCache.delete(u1);
    expect(await redisCache.get(u1)).toBeNull();
    expect(await redisCache.get(u2)).toEqual({ id: 2, name: 'Old Name 2' });

    // 2. Xóa toàn bộ cache thuộc module `users` khi có thay đổi hàng loạt (invalidateModule)
    const deletedUsersCount = await redisCache.invalidateModule('users');
    expect(deletedUsersCount).toBe(2); // xóa cả u2 (scoped) và uList (direct prefix)
    expect(await redisCache.get(u2)).toBeNull();
    expect(await redisCache.get(uList)).toBeNull();
    // Cache của module `roles` không bị ảnh hưởng
    expect(await redisCache.get(r1)).toEqual(['users.view', 'users.edit']);
  });

  it('7.5.5: Ngăn nhiều request cùng tạo một cache (Singleflight + Distributed Stampede Lock) — giảm tải Database', async () => {
    const cacheInstanceA = new BaseCacheProvider(config, redis);
    const cacheInstanceB = new BaseCacheProvider(config, redis);
    const key = cacheInstanceA.buildKey('reports', 'heavy_dashboard_kpi');

    let dbQueryCount = 0;
    const queryDatabase = async () => {
      dbQueryCount++;
      await new Promise((r) => setTimeout(r, 40));
      return { revenue: 150_000, activeUsers: 1240, generatedByCall: dbQueryCount };
    };

    // 30 request đồng thời trên Instance A + 20 request đồng thời trên Instance B cùng bị cache miss
    const concurrentRequests = [
      ...Array.from({ length: 30 }, () => cacheInstanceA.getOrSet(key, queryDatabase, 120)),
      ...Array.from({ length: 20 }, () => cacheInstanceB.remember(key, queryDatabase, 120)),
    ];

    const results = await Promise.all(concurrentRequests);

    // Chỉ đúng 1 lần truy vấn Database được thực thi cho cả 50 request đồng thời!
    expect(dbQueryCount).toBe(1);
    for (const res of results) {
      expect(res).toEqual({ revenue: 150_000, activeUsers: 1240, generatedByCall: 1 });
    }

    // Lần gọi tiếp theo đọc thẳng từ cache, không gọi DB thêm
    const cachedAfter = await cacheInstanceB.getOrSet(key, queryDatabase, 120);
    expect(cachedAfter).toEqual({ revenue: 150_000, activeUsers: 1240, generatedByCall: 1 });
    expect(dbQueryCount).toBe(1);
  });

  it('7.5.6: Tạo Distributed Lock — dùng cho job, scheduler và thao tác dễ trùng', async () => {
    const lockService = new DistributedLockService(config, redis);

    // 1. Tác vụ đầu tiên chiếm khóa thành công
    const handle1 = await lockService.acquire('invoice:generate:2026-10', {
      ttlMs: 10_000,
      ownerToken: 'worker_1',
    });
    expect(handle1).not.toBeNull();
    expect(await lockService.isLocked('invoice:generate:2026-10')).toBe(true);
    expect(await lockService.getHolder('invoice:generate:2026-10')).toBe('worker_1');

    // 2. Tác vụ thứ 2 cùng lúc bị chặn (trả về null hoặc ném DistributedLockConflictError khi dùng withLock)
    const handle2 = await lockService.acquire('invoice:generate:2026-10', {
      ttlMs: 10_000,
      ownerToken: 'worker_2',
    });
    expect(handle2).toBeNull();
    await expect(
      lockService.withLock('invoice:generate:2026-10', async () => 'should_not_run'),
    ).rejects.toThrow(DistributedLockConflictError);

    // 3. Không phải chủ sở hữu (worker_2) thì không thể giải phóng hoặc gia hạn khóa của worker_1
    expect(
      await lockService.release({ resource: 'invoice:generate:2026-10', token: 'worker_2' }),
    ).toBe(false);
    expect(
      await lockService.extend({ resource: 'invoice:generate:2026-10', token: 'worker_2' }, 20_000),
    ).toBe(false);

    // 4. Chủ sở hữu (worker_1) giải phóng khóa -> tác vụ tiếp theo chạy thành công qua withLock
    expect(await handle1!.release()).toBe(true);
    expect(await lockService.isLocked('invoice:generate:2026-10')).toBe(false);

    let executedInsideLock = false;
    const result = await lockService.withLock(
      'invoice:generate:2026-10',
      async (h) => {
        executedInsideLock = await lockService.isLocked(h.resource);
        return 'invoice_created';
      },
      { ttlMs: 5000 },
    );
    expect(result).toBe('invoice_created');
    expect(executedInsideLock).toBe(true);
    // Tự động giải phóng sau khi thoát withLock
    expect(await lockService.isLocked('invoice:generate:2026-10')).toBe(false);
  });

  it('7.5.7: Thiết lập thời gian hết hạn của lock — tránh khóa bị giữ vĩnh viễn khi tiến trình gặp sự cố', async () => {
    const lockService = new DistributedLockService(config, redis);

    // 1. Từ chối TTL <= 0 (bắt buộc mọi lock phải có thời gian hết hạn dương)
    await expect(lockService.acquire('job:sync', { ttlMs: 0 })).rejects.toThrow(
      /positive expiration time/,
    );
    await expect(lockService.acquire('job:sync', { ttlMs: -500 })).rejects.toThrow(
      /positive expiration time/,
    );

    // 2. Khi không truyền ttlMs -> tự động gán TTL mặc định (30_000ms), không bao giờ tạo khóa vĩnh viễn
    const defaultLock = await lockService.acquire('job:default_ttl');
    expect(defaultLock).not.toBeNull();
    expect(defaultLock!.ttlMs).toBe(30_000);
    const pttl = await redis.client.pttl(defaultLock!.lockKey);
    expect(pttl).toBeGreaterThan(25_000);
    await defaultLock!.release();

    // 3. Khi tiến trình giữ khóa bị treo/crash mà không gọi release(), khóa tự hết hạn sau TTL
    const shortLock = await lockService.acquire('job:crash_simulation', {
      ttlMs: 60,
      ownerToken: 'crashed_worker',
    });
    expect(shortLock).not.toBeNull();

    // Tiến trình thứ 2 có cấu hình retry tự động lấy được khóa ngay khi khóa cũ hết hạn
    const recoveredLock = await lockService.acquire('job:crash_simulation', {
      ttlMs: 5000,
      ownerToken: 'healthy_worker',
      retryCount: 4,
      retryDelayMs: 25,
    });
    expect(recoveredLock).not.toBeNull();
    expect(recoveredLock!.token).toBe('healthy_worker');
    await recoveredLock!.release();
  });

  it('7.5.8: Theo dõi lỗi và thời gian phản hồi Redis — đưa vào monitoring', async () => {
    const cache = new BaseCacheProvider(config, redis);
    const connection = new CacheConnectionService(cache, redis);
    connection.onApplicationBootstrap();
    const monitoring = new CacheMonitoringService(cache, connection, config, redis);
    const redisAdapter = new RedisManageableAdapter(redis);

    await cache.set('mon:item:1', { status: 'active' }, 60);
    await cache.get('mon:item:1');
    await cache.has('mon:item:1');

    // 1. Kiểm tra thống kê thời gian phản hồi lệnh (Latency Stats) trên BaseCacheProvider
    const statsBeforeError = cache.getLatencyStats();
    expect(statsBeforeError.totalCommands).toBe(3);
    expect(statsBeforeError.errorCount).toBe(0);
    expect(statsBeforeError.lastLatencyMs).not.toBeNull();
    expect(statsBeforeError.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(statsBeforeError.p95LatencyMs).toBeGreaterThanOrEqual(0);

    // 2. Kiểm tra đo thời gian phản hồi PING từ RedisMonitoringProvider & RedisManageableAdapter
    const pingMs = await monitoring.provider.ping();
    expect(typeof pingMs).toBe('number');
    expect(pingMs).toBeGreaterThanOrEqual(0);

    const statusReport = await redisAdapter.getStatus();
    expect(statusReport.metrics?.['ready']).toBe(true);
    expect(typeof statusReport.metrics?.['latencyMs']).toBe('number');

    // 3. Khi thao tác Redis gặp lỗi -> ghi nhận vào errorCount và đẩy bản ghi lỗi vào `cachemon:errors`
    const originalGet = redis.client.get.bind(redis.client);
    redis.client.get = (() =>
      Promise.reject(new Error('ETIMEDOUT: Redis command timed out'))) as never;
    try {
      const val = await cache.get('mon:item:1');
      expect(val).toBeNull();
    } finally {
      redis.client.get = originalGet;
    }

    const statsAfterError = cache.getLatencyStats();
    expect(statsAfterError.errorCount).toBe(1);

    const rawErrors = await redis.client.lrange(cacheKeys(redis).errors(), 0, 10);
    expect(rawErrors.length).toBeGreaterThanOrEqual(1);
    const parsedError = JSON.parse(rawErrors[0]!) as {
      kind: string;
      operation: string;
      namespace: string;
      message: string;
    };
    expect(parsedError.kind).toBe('timeout');
    expect(parsedError.operation).toBe('get');
    expect(parsedError.namespace).toBe('mon:item');
    expect(parsedError.message).toContain('timed out');

    connection.onModuleDestroy();
    monitoring.onModuleDestroy();
  });
});
