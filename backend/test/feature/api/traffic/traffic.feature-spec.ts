import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { TRAFFIC_ROUTES } from '@modules/traffic/index.js';
import { RedisService } from '@packages/redis/index.js';
import { TrafficCollectorService } from '@packages/traffic/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${TRAFFIC_ROUTES.PREFIX}`;

describe('HTTP Traffic (/ops/traffic)', () => {
  let context: TestAppContext;

  const get = async <T>(url: string, headers: Record<string, string> = {}) => {
    const res = await context.app.inject({ method: 'GET', url, headers });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
    await context.app.get(RedisService).client.flushall();
    // Traffic thật đi qua app: 200, 404 (không khớp route), 400 (validation, có body nhạy cảm).
    for (let i = 0; i < 3; i++) await context.app.inject({ method: 'GET', url: '/health' });
    await context.app.inject({ method: 'GET', url: '/khong-ton-tai' });
    await context.app.inject({
      method: 'POST',
      url: '/ops/runtimes/worker/stop',
      headers: { authorization: 'Bearer super-secret', 'content-type': 'application/json' },
      payload: { password: 'hunter2', confirm: 'nope' },
    });
    await context.app.get(TrafficCollectorService).flush();
  });

  afterAll(async () => {
    await context.close();
  });

  it('summary tính cả 404 và 400 (không bỏ sót request lỗi ngoài controller)', async () => {
    const { status, body } = await get<{
      stats: { requests: number; clientErrors: number };
      hasTraffic: boolean;
      statusClasses: { class: string; count: number }[];
    }>(`${base}/summary?range=15m`);
    expect(status).toBe(200);
    expect(body.data.hasTraffic).toBe(true);
    expect(body.data.stats.requests).toBe(5);
    expect(body.data.stats.clientErrors).toBe(2);
    expect(body.data.statusClasses.find((c) => c.class === '2xx')?.count).toBe(3);
  });

  it('endpoints: tự phát hiện route (kể cả chưa có request) và gom 404 vào (unmatched)', async () => {
    const { body } = await get<
      { route: string; method: string; status: string; stats: { requests: number } }[]
    >(`${base}/endpoints?range=15m`);
    const routes = body.data.map((r) => `${r.method} ${r.route}`);
    expect(routes).toContain('GET /health');
    expect(routes).toContain('GET (unmatched)');
    const idle = body.data.find((r) => r.route === '/ops/traffic/insights');
    expect(idle?.status).toBe('idle');
    expect(body.data[0]!.stats.requests).toBeGreaterThanOrEqual(body.data[1]!.stats.requests);
  });

  it('ẩn traffic nội bộ khi internal=false', async () => {
    const { body } = await get<{ stats: { requests: number } }>(
      `${base}/summary?range=15m&internal=false`,
    );
    // /health và /ops/* là nội bộ → chỉ còn request không khớp route.
    expect(body.data.stats.requests).toBe(1);
  });

  it('requests lọc theo status và request detail đã mask header/body', async () => {
    const list = await get<{ items: { id: string; status: number; errorCode: string | null }[] }>(
      `${base}/requests?status=4xx`,
    );
    expect(list.body.data.items.map((r) => r.status).sort()).toEqual([400, 404]);
    const failed = list.body.data.items.find((r) => r.status === 400)!;
    expect(failed.errorCode).toBe('VALIDATION_FAILED');

    const detail = await get<{
      detail: {
        headers: Record<string, string>;
        requestBody: { value: unknown };
        correlationId: string;
      };
    }>(`${base}/requests/${failed.id}`);
    const raw = JSON.stringify(detail.body.data);
    expect(raw).not.toContain('super-secret');
    expect(raw).not.toContain('hunter2');
    expect(detail.body.data.detail.requestBody.value).toMatchObject({ password: '[REDACTED]' });
    expect(detail.body.data.detail.correlationId).toBeTruthy();
  });

  it('request không tồn tại → 404; tham số sai → 400', async () => {
    const missing = await get(`${base}/requests/req_missing`, { 'accept-language': 'en' });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('TRAFFIC_REQUEST_NOT_FOUND');
    expect(missing.body.error?.message).toContain('may have expired');
    expect((await get(`${base}/summary?range=2d`)).status).toBe(400);
    expect((await get(`${base}/requests?status=abc`)).status).toBe(400);
  });

  it('timeseries, errors, active, insights trả đúng dạng', async () => {
    const ts = await get<{ series: { id: string }[]; unit: string }>(
      `${base}/timeseries?range=5m&metric=latency`,
    );
    expect(ts.body.data.unit).toBe('ms');
    expect(ts.body.data.series.map((s) => s.id)).toEqual(['p95', 'p50', 'p99']);

    const errors = await get<{ topCodes: { code: string }[] }>(`${base}/errors?range=15m`);
    expect(errors.body.data.topCodes.map((c) => c.code)).toContain('VALIDATION_FAILED');

    const active = await get<{ items: unknown[] }>(`${base}/active`);
    expect(Array.isArray(active.body.data.items)).toBe(true);

    const insights = await get<{
      rateLimit: { configured: boolean };
      security: { status: number }[];
    }>(`${base}/insights?range=15m`);
    expect(insights.body.data.rateLimit.configured).toBe(false);
    expect(insights.body.data.security.map((s) => s.status)).toEqual([401, 403, 429]);
  });

  it('Redis không sẵn sàng → 503 telemetry unavailable', async () => {
    const client = context.app.get(RedisService).client;
    Object.defineProperty(client, 'status', { value: 'reconnecting', configurable: true });
    try {
      const res = await get(`${base}/summary`);
      expect(res.status).toBe(503);
      expect(res.body.error?.code).toBe('TRAFFIC_TELEMETRY_UNAVAILABLE');
    } finally {
      Object.defineProperty(client, 'status', { value: 'ready', configurable: true });
    }
  });
});
