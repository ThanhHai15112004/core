import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  MetricRecorder,
  TELEMETRY_TIERS,
  histogramIndex,
  parseMetricHash,
  telemetryKeys,
  type MetricBucket,
} from '@packages/telemetry/index.js';

const AT = Date.UTC(2026, 8, 22, 10, 0, 5);
const bucketSec = (seconds: number) => {
  const s = Math.floor(AT / 1000);
  return s - (s % seconds);
};

describe('MetricRecorder', () => {
  let redis: RedisService;
  let config: CoreConfigService;
  let recorder: MetricRecorder;

  beforeEach(async () => {
    applyTestEnv();
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    recorder = new MetricRecorder(config, redis, 'api@host:1');
  });

  afterEach(async () => {
    await redis.onApplicationShutdown();
  });

  it('ghi counter, gauge, timing vào đủ 3 tầng bucket với TTL', async () => {
    recorder.count('worker.completed', 2, AT);
    recorder.gauge('rt.cpu', 30, AT);
    recorder.gauge('rt.cpu', 50, AT);
    recorder.timing('db.query', 120, AT);
    await recorder.flush(AT);

    const keys = telemetryKeys(redis);
    for (const [tier, { seconds, ttlSec }] of Object.entries(TELEMETRY_TIERS)) {
      const key = keys.bucket(
        tier as keyof typeof TELEMETRY_TIERS,
        bucketSec(seconds),
        'api@host:1',
      );
      const hash = await redis.client.hgetall(key);
      expect(Number(hash['worker.completed|c'])).toBe(2);
      expect(Number(hash['rt.cpu|n'])).toBe(2);
      expect(Number(hash['rt.cpu|s'])).toBe(80);
      expect(Number(hash['rt.cpu|x'])).toBe(50);
      expect(Number(hash[`db.query|h${histogramIndex(120)}`])).toBe(1);
      const ttl = await redis.client.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(ttlSec);
    }
    expect(await redis.client.zscore(keys.instances(), 'api@host:1')).not.toBeNull();
  });

  it('cộng dồn qua nhiều lần flush và gộp nhiều instance khi đọc', async () => {
    recorder.gauge('rt.cpu', 20, AT);
    await recorder.flush(AT);
    recorder.gauge('rt.cpu', 40, AT);
    await recorder.flush(AT);
    const other = new MetricRecorder(config, redis, 'worker@host:2');
    other.gauge('rt.cpu', 10, AT);
    await other.flush(AT);

    const keys = telemetryKeys(redis);
    const bucket: MetricBucket = { start: 0, metrics: new Map(), byInstance: new Map() };
    for (const inst of ['api@host:1', 'worker@host:2'])
      parseMetricHash(
        await redis.client.hgetall(keys.bucket('s10', bucketSec(10), inst)),
        inst,
        bucket,
      );

    expect(bucket.metrics.get('rt.cpu')).toMatchObject({ n: 3, s: 70, x: 40 });
    expect(bucket.byInstance.get('api@host:1')!.get('rt.cpu')).toMatchObject({
      n: 2,
      s: 60,
      x: 40,
    });
  });

  it('không ghi gì khi không có instance (CLI) hoặc PERF_ENABLED=false', async () => {
    const cli = new MetricRecorder(config, redis, null);
    cli.count('msg.published');
    await cli.flush();
    applyTestEnv({ PERF_ENABLED: 'false' });
    const disabled = new MetricRecorder(new CoreConfigService(), redis, 'api@host:1');
    disabled.count('msg.published');
    await disabled.flush();
    expect(await redis.client.keys('*perf*')).toEqual([]);
    applyTestEnv({ PERF_ENABLED: 'true' });
  });
});
