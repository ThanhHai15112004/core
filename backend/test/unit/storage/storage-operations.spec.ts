import { describe, it, expect, beforeEach, afterEach, afterAll } from '@jest/globals';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  BaseStorageProvider,
  StorageConnectionService,
  StorageMonitoringService,
  StorageOperationsService,
  storageKeys,
} from '@packages/storage/index.js';
import {
  diffStorageAlerts,
  evaluateStorageRules,
  type StorageRuleInput,
} from '@modules/storage-ops/index.js';

const ctx = { ip: '10.0.0.x', actor: null };
const ENV = [
  'OPS_STORAGE_DELETE_ENABLED',
  'OPS_STORAGE_PREVIEW_ENABLED',
  'STORAGE_SENSITIVE_PREFIXES',
];

describe('StorageOperationsService (local)', () => {
  let dir: string;
  let redis: RedisService;
  let storage: BaseStorageProvider;

  const build = async (env: Record<string, string> = {}) => {
    applyTestEnv({
      STORAGE_LOCAL_PATH: dir,
      OPS_STORAGE_DELETE_ENABLED: 'true',
      OPS_STORAGE_PREVIEW_ENABLED: 'true',
      ...env,
    });
    const config = new CoreConfigService();
    storage = new BaseStorageProvider(config, redis);
    const connection = new StorageConnectionService(storage, config, redis);
    await connection.check();
    const monitoring = new StorageMonitoringService(storage, connection, config, redis);
    return {
      ops: new StorageOperationsService(storage, connection, monitoring, config, redis),
      monitoring,
    };
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'core-storage-ops-'));
    applyTestEnv();
    redis = new RedisService(new CoreConfigService(), mockRedisFactory);
    await redis.client.flushall();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  afterAll(() => {
    for (const k of ENV) delete process.env[k];
  });

  it('Test Storage: đủ 5 bước, không để lại object tạm, có audit', async () => {
    const { ops } = await build();
    const res = await ops.test(ctx);
    expect(res.ok).toBe(true);
    expect(res.steps.map((s) => s.step)).toEqual(['connect', 'write', 'read', 'verify', 'delete']);
    expect(await fs.readdir(dir)).toEqual(['.core-healthcheck']);
    expect(await fs.readdir(path.join(dir, '.core-healthcheck'))).toEqual([]);
    expect(await redis.client.llen(storageKeys(redis).operations())).toBe(1);
  });

  it('upload qua StorageContract được đo; xoá có audit + sự kiện; không tồn tại → NOT_FOUND', async () => {
    const { ops } = await build();
    await storage.upload('docs/a.txt', Buffer.from('hi'));
    expect(await storage.exists('docs/a.txt')).toBe(true);
    const record = await ops.deleteObject('docs/a.txt', null, ctx);
    expect(record).toMatchObject({ action: 'delete_object', result: 'success', ip: '10.0.0.x' });
    expect(await storage.exists('docs/a.txt')).toBe(false);
    const events = await redis.client.lrange(storageKeys(redis).events(), 0, -1);
    expect(JSON.parse(events[0]!)).toMatchObject({ type: 'object_deleted' });
    await expect(ops.deleteObject('docs/a.txt', null, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(storage.download('docs/missing.txt')).rejects.toBeDefined();
    const errors = await redis.client.lrange(storageKeys(redis).errors(), 0, -1);
    expect(JSON.parse(errors[0]!)).toMatchObject({
      op: 'get',
      kind: 'not_found',
      code: 'ENOENT',
      container: 'docs',
    });
    expect(JSON.parse(errors[0]!).message).not.toContain(dir);
  });

  it('chặn khi tắt, prefix nhạy cảm, signed URL không hỗ trợ trên local', async () => {
    const off = (await build({ OPS_STORAGE_DELETE_ENABLED: 'false' })).ops;
    await expect(off.deleteObject('a.txt', null, ctx)).rejects.toMatchObject({
      code: 'DELETE_DISABLED',
    });
    const { ops } = await build({ STORAGE_SENSITIVE_PREFIXES: 'private/' });
    await storage.upload('private/secret.json', Buffer.from('{"password":"x"}'));
    await expect(ops.preview('private/secret.json', ctx)).rejects.toMatchObject({
      code: 'SENSITIVE',
    });
    await storage.upload('public/data.json', Buffer.from('{"a":1}'));
    expect(await ops.preview('public/data.json', ctx)).toMatchObject({
      kind: 'text',
      text: '{"a":1}',
    });
    await expect(ops.signedUrl('public/data.json', 900, ctx)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });
});

describe('evaluateStorageRules', () => {
  const cfg = { ...new CoreConfigService().storage.rules, largeObjectBytes: 500 * 1024 * 1024 };
  const base: StorageRuleInput = {
    connection: 'connected',
    capacityPercent: 40,
    growth: { last24h: null, avgDaily7d: null, topContainer: null, topContainerBytes: null },
    upload: { ops: 100, failureRatePercent: 0, p95Ms: 200 },
    download: { ops: 100, failureRatePercent: 0 },
    staleMultipart: { count: 0, bytes: 0 },
    largestObject: null,
  };

  it('bình thường → không cảnh báo; mất kết nối → chỉ STORAGE_UNAVAILABLE', () => {
    expect(evaluateStorageRules(base, cfg)).toEqual([]);
    expect(
      evaluateStorageRules({ ...base, connection: 'unavailable' }, cfg).map((v) => v.id),
    ).toEqual(['STORAGE_UNAVAILABLE']);
  });

  it('capacity, tăng bất thường, upload lỗi/chậm, multipart treo, object lớn', () => {
    const GB = 1024 ** 3;
    const v = evaluateStorageRules(
      {
        ...base,
        capacityPercent: 92,
        growth: {
          last24h: 18 * GB,
          avgDaily7d: 2 * GB,
          topContainer: 'uploads',
          topContainerBytes: 14 * GB,
        },
        upload: { ops: 100, failureRatePercent: 25, p95Ms: 4200 },
        staleMultipart: { count: 2, bytes: GB },
        largestObject: { key: 'video/x.mp4', size: 4 * GB },
      },
      cfg,
    );
    const byId = Object.fromEntries(v.map((x) => [x.id, x]));
    expect(byId['CAPACITY']!.severity).toBe('critical');
    expect(byId['RAPID_GROWTH']!.extra['container']).toBe('uploads');
    expect(byId['UPLOAD_FAILURE_RATE']!.severity).toBe('critical');
    expect(byId['UPLOAD_LATENCY']).toBeDefined();
    expect(byId['STALE_MULTIPART']!.value).toBe(2);
    expect(byId['LARGE_OBJECT']!.severity).toBe('info');
  });

  it('ít thao tác → không kết luận tỷ lệ lỗi; diff bắt đầu/hồi phục', () => {
    expect(
      evaluateStorageRules(
        { ...base, upload: { ops: 3, failureRatePercent: 100, p95Ms: 9000 } },
        cfg,
      ),
    ).toEqual([]);
    const [violation] = evaluateStorageRules({ ...base, capacityPercent: 85 }, cfg);
    const first = diffStorageAlerts([violation!], new Map(), 0);
    expect(first.started).toHaveLength(1);
    expect(diffStorageAlerts([], first.set, 60_000).recovered[0]).toMatchObject({
      id: 'CAPACITY',
      durationMs: 60_000,
    });
  });
});
