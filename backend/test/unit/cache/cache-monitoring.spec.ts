import { describe, it, expect, beforeEach } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  RedisMonitoringProvider,
  buildKeyspaceSnapshot,
  mergeKeyspaceSnapshots,
  parseClientList,
  parseInfo,
  serverInfoFrom,
  ttlBucketOf,
  type ScannedKey,
} from '@packages/cache/index.js';

const MIN = 60_000;

describe('buildKeyspaceSnapshot', () => {
  const keys: ScannedKey[] = [
    { key: 'user:1', ttlMs: 30_000, bytes: 100, type: 'string' },
    { key: 'user:2', ttlMs: 5 * MIN, bytes: 300, type: 'string' },
    { key: 'data:users:1', ttlMs: 2 * 3600_000, bytes: 2_000_000, type: 'string' },
    { key: 'config', ttlMs: null, bytes: 50, type: 'string' },
    { key: 'user:3', ttlMs: null, bytes: null, type: 'hash' },
  ];

  it('gom TTL, namespace, key lớn nhất', () => {
    const s = buildKeyspaceSnapshot({
      keys,
      total: 5,
      truncated: false,
      driver: 'redis',
      depth: 2,
      at: 1,
      durationMs: 3,
    });
    expect(s.totalKeys).toBe(5);
    expect(s.persistent).toBe(2);
    expect(s.expiring).toBe(3);
    expect(s.expiringNext60s).toBe(1);
    expect(s.bytesPartial).toBe(true);
    expect(s.ttlDistribution).toEqual({
      lt1m: 1,
      '1to10m': 1,
      '10to60m': 0,
      '1to24h': 1,
      gt24h: 0,
      none: 2,
    });
    const user = s.namespaces.find((n) => n.name === 'user')!;
    expect(user).toMatchObject({ keys: 3, bytes: 400, persistent: 1, expiringSoon: 1 });
    expect(user.avgTtlMs).toBe(Math.round((30_000 + 5 * MIN) / 2));
    expect(s.largestKeys[0]).toMatchObject({ key: 'data:users:1', namespace: 'data:users' });
  });

  it('gộp snapshot của nhiều runtime (driver memory)', () => {
    const a = buildKeyspaceSnapshot({
      keys: keys.slice(0, 2),
      total: 2,
      truncated: false,
      driver: 'memory',
      depth: 2,
      at: 1,
      durationMs: 1,
    });
    const b = buildKeyspaceSnapshot({
      keys: keys.slice(2),
      total: 3,
      truncated: true,
      driver: 'memory',
      depth: 2,
      at: 1,
      durationMs: 2,
    });
    const m = mergeKeyspaceSnapshots([a, b], 5)!;
    expect(m.totalKeys).toBe(5);
    expect(m.truncated).toBe(true);
    expect(m.namespaces.find((n) => n.name === 'user')!.keys).toBe(3);
  });

  it('bucket TTL', () => {
    expect(ttlBucketOf(null)).toBe('none');
    expect(ttlBucketOf(59_999)).toBe('lt1m');
    expect(ttlBucketOf(25 * 3600_000)).toBe('gt24h');
  });
});

describe('INFO / CLIENT LIST', () => {
  it('parse số liệu server; maxmemory 0 = không giới hạn', () => {
    const info = parseInfo(
      '# Server\r\nredis_version:7.4.1\r\nuptime_in_seconds:100\r\n# Memory\r\nused_memory:1048576\r\nmaxmemory:0\r\nmaxmemory_policy:noeviction\r\nmem_fragmentation_ratio:1.12\r\n# Stats\r\nevicted_keys:3\r\n# Keyspace\r\ndb0:keys=10,expires=4,avg_ttl=1\r\n',
    );
    const s = serverInfoFrom(info, { maxMemory: null, policy: null, maxClients: 10000 }, 0);
    expect(s).toMatchObject({
      version: '7.4.1',
      usedMemory: 1048576,
      maxMemory: null,
      maxMemoryPolicy: 'noeviction',
      fragmentationRatio: 1.12,
      evictedKeys: 3,
      maxClients: 10000,
    });
    expect(s.keyspace).toEqual([{ db: 'db0', keys: 10, expires: 4 }]);
  });

  it('parse CLIENT LIST', () => {
    const rows = parseClientList(
      'id=7 addr=1.2.3.4:5 name=core-api age=10 idle=0 flags=N db=0 cmd=get\nid=8 name=x flags=b cmd=bzpopmin\n',
    );
    expect(rows[0]).toMatchObject({ id: '7', name: 'core-api', cmd: 'get' });
    expect(rows[1]!['flags']).toBe('b');
  });
});

describe('RedisMonitoringProvider (ioredis-mock)', () => {
  let redis: RedisService;
  let provider: RedisMonitoringProvider;

  beforeEach(async () => {
    applyTestEnv();
    redis = new RedisService(new CoreConfigService(), mockRedisFactory);
    await redis.client.flushall();
    provider = new RedisMonitoringProvider(redis, 2);
    await redis.client.set('core_test:cache:user:1', '{"a":1}', 'PX', 30_000);
    await redis.client.set(
      'core_test:cache:user:2',
      '{"password":"x","email":"alice@example.com"}',
    );
    await redis.client.hset('core_test:cache:data:users:1', 'name', 'A', 'age', '3');
    await redis.client.set('core_test:perf:other', '1');
  });

  it('SCAN chỉ vùng cache; MEMORY USAGE không có → kích thước null', async () => {
    const all = await provider.scanAll(100);
    expect(all.total).toBe(3);
    expect(all.truncated).toBe(false);
    expect(all.keys.map((k) => k.key).sort()).toEqual(['data:users:1', 'user:1', 'user:2']);
    expect(all.keys.every((k) => k.bytes === null)).toBe(true);
  });

  it('lọc theo namespace / TTL / type', async () => {
    const byNs = await provider.scanPage(
      { match: '', type: null, ttl: 'any', namespace: 'user' },
      '0',
      50,
    );
    expect(byNs.keys.map((k) => k.key).sort()).toEqual(['user:1', 'user:2']);
    const persistent = await provider.scanPage(
      { match: 'user:*', type: null, ttl: 'persistent', namespace: null },
      '0',
      50,
    );
    expect(persistent.keys.map((k) => k.key)).toEqual(['user:2']);
    const hashes = await provider.scanPage(
      { match: '', type: 'hash', ttl: 'any', namespace: null },
      '0',
      50,
    );
    expect(hashes.keys.map((k) => k.key)).toEqual(['data:users:1']);
    expect(byNs.cursor).toBe('0');
  });

  it('chi tiết key và mẫu value (giới hạn)', async () => {
    expect(await provider.keyInfo('data:users:1')).toMatchObject({
      type: 'hash',
      length: 2,
      namespace: 'data:users',
      ttlMs: null,
    });
    expect(await provider.keyInfo('missing')).toBeNull();
    expect(await provider.sample('user:1', 2048, 50)).toEqual({
      kind: 'json',
      value: { a: 1 },
      truncated: false,
    });
    const hash = await provider.sample('data:users:1', 2048, 1);
    expect(hash).toMatchObject({ kind: 'entries', truncated: true, total: 2 });
  });
});
