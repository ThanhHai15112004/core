import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { sample, stubPrometheus } from '../../../concerns/prometheus.concern.js';
import { TRAFFIC_ROUTES } from '@modules/traffic/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${TRAFFIC_ROUTES.PREFIX}`;

const HEALTH = { method: 'GET', route: '/health' };
const STOP = { method: 'POST', route: '/ops/runtimes/:id/stop' };
const ORDERS = { method: 'GET', route: '/api/v1/orders' };

/**
 * Prometheus giả: 3×200 + 1×302 trên route nội bộ, 1×400 trên route nội bộ, 1×500 trên route công khai.
 * Query có `route!~` (ẩn nội bộ) chỉ thấy request công khai.
 */
function promql(expr: string) {
  const external = expr.includes('route!~');
  if (expr.includes('sum by (status)'))
    return external
      ? [sample(1, { status: '500' })]
      : [
          sample(3, { status: '200' }),
          sample(1, { status: '302' }),
          sample(1, { status: '400' }),
          sample(1, { status: '500' }),
        ];
  if (expr.startsWith('sum(increase(http_request_duration_seconds_sum'))
    return [sample(external ? 0.2 : 0.6)];
  if (expr.includes('route, method)')) {
    if (expr.includes('status=~"5..')) return [sample(1, ORDERS)];
    if (expr.includes('status=~"4..')) return [sample(1, STOP)];
    if (expr.includes('_sum[')) return [sample(0.03, HEALTH), sample(0.2, ORDERS)];
    if (expr.includes('_count[')) return [sample(4, HEALTH), sample(1, STOP), sample(1, ORDERS)];
    if (expr.startsWith('histogram_quantile(0.5,')) return [sample(0.004, HEALTH)];
    if (expr.startsWith('histogram_quantile(0.95,')) return [sample(0.02, HEALTH)];
    if (expr.startsWith('histogram_quantile(0.99,')) return [sample(0.03, HEALTH)];
  }
  if (expr.startsWith('histogram_quantile(0.50,')) return [sample(0.01)];
  if (expr.startsWith('histogram_quantile(0.95,')) return [sample(0.05)];
  if (expr.startsWith('histogram_quantile(0.99,')) return [sample(0.2)];
  return [];
}

describe('HTTP Traffic (/ops/traffic)', () => {
  let context: TestAppContext;

  const get = async <T>(url: string, headers: Record<string, string> = {}) => {
    const res = await context.app.inject({ method: 'GET', url, headers });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  describe('Prometheus chưa cấu hình (PROMETHEUS_URL trống)', () => {
    it('summary / timeseries / endpoints → 503 telemetry unavailable, không trả số 0 giả', async () => {
      for (const url of [
        `${base}/summary?range=15m`,
        `${base}/timeseries?range=5m&metric=latency`,
        `${base}/endpoints?range=15m`,
      ]) {
        const res = await get(url, { 'accept-language': 'en' });
        expect(res.status).toBe(503);
        expect(res.body.error?.code).toBe('TRAFFIC_TELEMETRY_UNAVAILABLE');
        expect(res.body.error?.message).toContain('Prometheus');
      }
    });

    it('request không tồn tại → 404; tham số sai → 400', async () => {
      const missing = await get(`${base}/requests/req_missing`, { 'accept-language': 'en' });
      expect(missing.status).toBe(404);
      expect(missing.body.error?.code).toBe('TRAFFIC_REQUEST_NOT_FOUND');
      expect(missing.body.error?.message).toContain('may have expired');
      expect((await get(`${base}/summary?range=2d`)).status).toBe(400);
      expect((await get(`${base}/requests?status=abc`)).status).toBe(400);
    });
  });

  describe('số liệu từ Prometheus', () => {
    let restore: () => void;

    beforeAll(() => {
      restore = stubPrometheus(context.app, {
        query: promql,
        range: () => [
          {
            labels: {},
            points: [
              { t: 1_000, v: 12.345 },
              { t: 2_000, v: 40 },
              { t: 3_000, v: 20 },
            ],
          },
        ],
      });
    });

    afterAll(() => restore());

    it('summary: đếm theo lớp status thật (kể cả 3xx), độ trễ trung bình và phân vị', async () => {
      const { status, body } = await get<{
        hasTraffic: boolean;
        stats: {
          requests: number;
          clientErrors: number;
          serverErrors: number;
          avgLatencyMs: number;
          p50LatencyMs: number;
          p95LatencyMs: number;
          p99LatencyMs: number;
        };
        statusClasses: { class: string; count: number }[];
        topStatuses: { status: number; count: number }[];
      }>(`${base}/summary?range=15m`);
      expect(status).toBe(200);
      expect(body.data.hasTraffic).toBe(true);
      expect(body.data.stats).toMatchObject({
        requests: 6,
        clientErrors: 1,
        serverErrors: 1,
        avgLatencyMs: 100,
        p50LatencyMs: 10,
        p95LatencyMs: 50,
        p99LatencyMs: 200,
      });
      expect(Object.fromEntries(body.data.statusClasses.map((c) => [c.class, c.count]))).toEqual({
        '2xx': 3,
        '3xx': 1,
        '4xx': 1,
        '5xx': 1,
      });
      expect(body.data.topStatuses[0]).toEqual({ status: 200, count: 3 });
    });

    it('ẩn traffic nội bộ khi internal=false', async () => {
      const { body } = await get<{ stats: { requests: number; serverErrors: number } }>(
        `${base}/summary?range=15m&internal=false`,
      );
      expect(body.data.stats).toMatchObject({ requests: 1, serverErrors: 1 });
    });

    it('endpoints: phân vị và độ trễ trung bình thật theo route, lọc route nội bộ', async () => {
      const { body } = await get<
        {
          id: string;
          internal: boolean;
          status: string;
          stats: {
            requests: number;
            avgLatencyMs: number | null;
            p50LatencyMs: number | null;
            p95LatencyMs: number | null;
            p99LatencyMs: number | null;
            clientErrors: number;
            serverErrors: number;
          };
        }[]
      >(`${base}/endpoints?range=15m`);
      expect(body.data.map((e) => e.id)).toEqual([
        'GET /health',
        'POST /ops/runtimes/:id/stop',
        'GET /api/v1/orders',
      ]);
      expect(body.data[0]!.stats).toMatchObject({
        requests: 4,
        avgLatencyMs: 7.5,
        p50LatencyMs: 4,
        p95LatencyMs: 20,
        p99LatencyMs: 30,
      });
      // Không có histogram cho route → không suy ra phân vị.
      const orders = body.data.find((e) => e.id === 'GET /api/v1/orders')!;
      expect(orders.stats).toMatchObject({
        avgLatencyMs: 200,
        p50LatencyMs: null,
        p95LatencyMs: null,
        p99LatencyMs: null,
        serverErrors: 1,
      });
      expect(orders.status).toBe('failing');
      expect(body.data.find((e) => e.id === 'POST /ops/runtimes/:id/stop')!.internal).toBe(true);

      const publicOnly = await get<{ id: string }[]>(`${base}/endpoints?range=15m&internal=false`);
      expect(publicOnly.body.data.map((e) => e.id)).toEqual(['GET /api/v1/orders']);
    });

    it('timeseries, errors, active, insights trả đúng dạng', async () => {
      const ts = await get<{
        series: { id: string; points: { value: number }[] }[];
        unit: string;
        current: number;
        peak: number;
      }>(`${base}/timeseries?range=5m&metric=latency`);
      expect(ts.body.data.unit).toBe('ms');
      expect(ts.body.data.series.map((s) => s.id)).toEqual(['latency']);
      expect(ts.body.data.series[0]!.points.map((p) => p.value)).toEqual([12.35, 40, 20]);
      expect(ts.body.data).toMatchObject({ current: 20, peak: 40 });

      const errors = await get<{ topRoutes: { routeId: string }[] }>(`${base}/errors?range=15m`);
      expect(errors.body.data.topRoutes.map((r) => r.routeId).sort()).toEqual([
        'GET /api/v1/orders',
        'POST /ops/runtimes/:id/stop',
      ]);

      const active = await get<{ items: unknown[] }>(`${base}/active`);
      expect(Array.isArray(active.body.data.items)).toBe(true);

      const insights = await get<{
        rateLimit: { configured: boolean };
        last24h: { total: number; serverErrors: number };
      }>(`${base}/insights?range=15m`);
      expect(insights.body.data.rateLimit.configured).toBe(false);
      expect(insights.body.data.last24h).toMatchObject({ total: 6, serverErrors: 1 });
    });
  });
});
