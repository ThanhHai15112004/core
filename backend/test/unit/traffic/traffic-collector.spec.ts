import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { HttpMetricsService } from '@packages/logging/index.js';
import { annotateRequestError } from '@packages/http/index.js';
import {
  CLIENT_CLOSED_STATUS,
  TrafficCollectorService,
  routeIdOf,
  trafficKeys,
  type RequestDetail,
  type RequestSummary,
} from '@packages/traffic/index.js';

interface FakeRequest {
  raw: object;
  method: string;
  url: string;
  routeOptions: { url?: string };
  headers: Record<string, string>;
  query: Record<string, string>;
  ip: string;
  body?: unknown;
}

const request = (o: Partial<FakeRequest> = {}): FakeRequest => ({
  raw: {},
  method: 'GET',
  url: '/api/v1/users/42?page=1',
  routeOptions: { url: '/api/v1/users/:id' },
  headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
  query: { page: '1' },
  ip: '10.1.2.3',
  ...o,
});

const reply = (statusCode: number) => {
  const headers: Record<string, string> = {
    'x-correlation-id': 'corr-1',
    'content-type': 'application/json',
  };
  return {
    statusCode,
    getHeader: (name: string) => headers[name],
    getHeaders: () => headers,
  };
};

const asReq = (r: FakeRequest) => r as unknown as FastifyRequest;
const asReply = (r: ReturnType<typeof reply>) => r as unknown as FastifyReply;

describe('TrafficCollectorService', () => {
  let redis: RedisService;
  let collector: TrafficCollectorService;
  let http: HttpMetricsService;
  let keys: ReturnType<typeof trafficKeys>;

  const run = (r: FakeRequest, status: number) => {
    collector.start(asReq(r));
    collector.keepRequestBody(asReq(r));
    collector.finish(asReq(r), asReply(reply(status)));
  };

  beforeEach(async () => {
    applyTestEnv({
      TRAFFIC_SLOW_MS: '500',
      TRAFFIC_SAMPLE_RATE: '0',
      TRAFFIC_INSTANCE_ID: 'api-1',
    });
    const config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    http = new HttpMetricsService();
    collector = new TrafficCollectorService(config, redis, http);
    keys = trafficKeys(redis);
  });

  afterEach(async () => {
    await collector.beforeApplicationShutdown();
  });

  it('ghi aggregate theo route template (không theo URL thô) cho cả 3 tầng', async () => {
    run(request(), 200);
    run(request({ raw: {}, url: '/api/v1/users/7' }), 200);
    await collector.flush();

    const rid = routeIdOf('GET', '/api/v1/users/:id');
    const bucketKeys = await redis.client.keys(`${redis.key('traffic', 'b')}:*`);
    expect(bucketKeys.filter((k) => k.endsWith(':api-1'))).toHaveLength(3);
    const hash = await redis.client.hgetall(bucketKeys[0]!);
    expect(hash[`${rid}|n`]).toBe('2');
    expect(hash[`${rid}|s200`]).toBe('2');
    const routes = await redis.client.hgetall(keys.routes());
    expect(JSON.parse(routes[rid]!)).toMatchObject({ module: 'users', route: '/api/v1/users/:id' });
  });

  it('log nhẹ mọi request, chỉ lưu chi tiết request lỗi/chậm — đã mask', async () => {
    const ok = request();
    const failed = request({ raw: {}, method: 'POST', body: { email: 'a@b.co', password: 'p' } });
    annotateRequestError(failed.raw, { code: 'VALIDATION_FAILED', name: 'X', message: 'm' });
    run(ok, 200);
    run(failed, 400);
    await collector.flush();

    const log = (await redis.client.lrange(keys.requestLog(), 0, -1)).map(
      (r) => JSON.parse(r) as RequestSummary,
    );
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      method: 'POST',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      captured: true,
      path: '/api/v1/users/42',
    });
    expect(log[1]).toMatchObject({
      status: 200,
      captured: false,
      errorCode: null,
      correlationId: 'corr-1',
    });

    expect(await redis.client.get(keys.requestDetail(log[1]!.id))).toBeNull();
    const detail = JSON.parse(
      (await redis.client.get(keys.requestDetail(log[0]!.id)))!,
    ) as RequestDetail;
    expect(detail.captureReason).toBe('error');
    expect(detail.headers['authorization']).not.toContain('secret');
    expect(detail.requestBody.value).toEqual({ email: 'a***@b.co', password: '[REDACTED]' });
    expect(detail.ip).toBe('10.1.2.x');
    expect(detail.timeline.map((m) => m.phase)).toEqual(['received', 'finished']);
  });

  it('theo dõi request đang chạy và peak', async () => {
    const r = request();
    collector.start(asReq(r));
    expect(collector.activeSnapshot().active).toHaveLength(1);
    expect(http.activeRequests()).toBe(1);
    await collector.flush();
    const snap = JSON.parse((await redis.client.get(keys.active('api-1')))!) as {
      active: unknown[];
    };
    expect(snap.active).toHaveLength(1);

    collector.finish(asReq(r), null);
    expect(collector.activeSnapshot().active).toHaveLength(0);
    await collector.flush();
    const log = JSON.parse((await redis.client.lindex(keys.requestLog(), 0))!) as RequestSummary;
    expect(log.status).toBe(CLIENT_CLOSED_STATUS);
  });

  it('bỏ qua method/route bị loại trừ', async () => {
    applyTestEnv({ TRAFFIC_EXCLUDE_ROUTES: '/api/v1/health*' });
    collector = new TrafficCollectorService(new CoreConfigService(), redis, http);
    run(request({ method: 'OPTIONS' }), 204);
    run(request({ raw: {}, routeOptions: { url: '/api/v1/health' } }), 200);
    await collector.flush();
    expect(await redis.client.llen(keys.requestLog())).toBe(0);
    expect(http.snapshot().totalRequests).toBe(0);
  });

  it('request không khớp route được gom vào (unmatched) và vẫn cập nhật metric runtime', async () => {
    run(request({ routeOptions: {} }), 404);
    await collector.flush();
    const log = JSON.parse((await redis.client.lindex(keys.requestLog(), 0))!) as RequestSummary;
    expect(log.route).toBe('(unmatched)');
    expect(http.snapshot().totalRequests).toBe(1);
  });

  it('không ghi Redis khi chưa sẵn sàng nhưng giữ dữ liệu để lần sau', async () => {
    Object.defineProperty(redis.client, 'status', { value: 'reconnecting', configurable: true });
    run(request(), 200);
    await collector.flush();
    expect(await redis.client.llen(keys.requestLog())).toBe(0);
    Object.defineProperty(redis.client, 'status', { value: 'ready', configurable: true });
    await collector.flush();
    expect(await redis.client.llen(keys.requestLog())).toBe(1);
  });
});
