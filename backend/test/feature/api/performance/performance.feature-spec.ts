import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { sample, stubPrometheus } from '../../../concerns/prometheus.concern.js';
import { PERFORMANCE_ROUTES } from '@modules/performance/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${PERFORMANCE_ROUTES.PREFIX}`;

/** Prometheus giả: 2 req/s, 5% lỗi 5xx, p95 120ms, CPU 35%, RSS 256MB. */
function promql(expr: string) {
  if (expr.startsWith('histogram_quantile(0.95,')) return [sample(0.12)];
  if (expr.includes('status=~"5..')) return [sample(0.1)];
  if (expr.startsWith('sum(rate(http_request_duration_seconds_count')) return [sample(2)];
  if (expr.includes('process_cpu_seconds_total')) return [sample(35)];
  if (expr.includes('process_resident_memory_bytes')) return [sample(256 * 1024 * 1024)];
  return [];
}

describe('Performance (/ops/performance)', () => {
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
    it('overview / timeseries → 503 telemetry unavailable', async () => {
      for (const url of [`${base}/overview?range=15m`, `${base}/timeseries?metric=latency`]) {
        const res = await get(url, { 'accept-language': 'en' });
        expect(res.status).toBe(503);
        expect(res.body.error?.code).toBe('PERFORMANCE_TELEMETRY_UNAVAILABLE');
        expect(res.body.error?.message).toContain('Prometheus');
      }
    });

    it('component detail, 404 và validation', async () => {
      const api = await get<{ id: string }>(`${base}/components/api?range=15m`);
      expect(api.status).toBe(200);
      expect(api.body.data.id).toBe('api');

      const missing = await get(`${base}/components/nope`, { 'accept-language': 'en' });
      expect(missing.status).toBe(404);
      expect(missing.body.error?.message).toBe('Component nope does not exist.');
      expect((await get(`${base}/overview?range=30d`)).status).toBe(400);
      expect((await get(`${base}/timeseries?metric=disk`)).status).toBe(400);
    });

    it('events và bottlenecks trả về danh sách', async () => {
      expect((await get<unknown[]>(`${base}/bottlenecks`)).body.data).toEqual([]);
      const events = await get<unknown[]>(`${base}/events?range=1h`);
      expect(events.status).toBe(200);
      expect(Array.isArray(events.body.data)).toBe(true);
    });
  });

  describe('số liệu từ Prometheus', () => {
    let restore: () => void;

    beforeAll(() => {
      restore = stubPrometheus(context.app, {
        query: promql,
        range: (expr) => [
          {
            labels: {},
            points: expr.includes('process_cpu')
              ? [{ t: 1_000, v: 30 }]
              : [
                  { t: 1_000, v: 1.5 },
                  { t: 2_000, v: 2.5 },
                ],
          },
        ],
      });
    });

    afterAll(() => restore());

    it('overview: KPI thật từ Prometheus; thành phần chưa đo → unavailable, không có số giả', async () => {
      const { status, body } = await get<{
        telemetry: { database: string };
        kpis: {
          apiP95Ms: { value: number };
          throughputPerSec: { value: number };
          cpuPercent: { value: number };
          memoryMb: { value: number; limitMb: number | null; percent: number | null };
          errorRatePercent: { value: number };
        };
        breakdown: { requests: number; avgTotalMs: number | null; phases: unknown[] };
        components: { id: string; status: string; note: string | null; load: number | null }[];
        capacity: { key: string; limit: number | null }[];
        budgets: { key: string; met: boolean | null }[];
      }>(`${base}/overview?range=15m`, { 'accept-language': 'en' });
      expect(status).toBe(200);
      const d = body.data;
      expect(d.kpis.apiP95Ms.value).toBe(120);
      expect(d.kpis.throughputPerSec.value).toBe(2);
      expect(d.kpis.errorRatePercent.value).toBe(5);
      expect(d.kpis.cpuPercent.value).toBe(35);
      expect(d.kpis.memoryMb).toMatchObject({ value: 256, limitMb: null, percent: null });
      expect(d.capacity.find((c) => c.key === 'memory')!.limit).toBeNull();

      // Prometheus không có thời gian theo giai đoạn → không chia ước lượng.
      expect(d.breakdown).toMatchObject({ requests: 1800, avgTotalMs: null, phases: [] });
      expect(d.telemetry.database).toBe('unavailable');

      const api = d.components.find((c) => c.id === 'api')!;
      expect(api).toMatchObject({ status: 'normal', load: 2 });
      for (const id of ['database', 'cache', 'worker', 'messaging']) {
        expect(d.components.find((c) => c.id === id)).toMatchObject({
          status: 'unavailable',
          note: 'Not measured via Prometheus yet',
          load: null,
        });
      }
      expect(d.budgets.find((b) => b.key === 'apiP95Ms')!.met).toBe(true);
      expect(d.budgets.find((b) => b.key === 'errorRatePercent')!.met).toBe(false);
    });

    it('timeseries: series chính + so sánh (trục phải)', async () => {
      const { status, body } = await get<{
        series: { id: string; axis: string; kind: string; points: { value: number }[] }[];
        stats: { current: number | null; peak: number | null };
        unit: string;
      }>(`${base}/timeseries?range=15m&metric=throughput&compare=cpu`);
      expect(status).toBe(200);
      expect(body.data.series.map((s) => `${s.kind}:${s.id}:${s.axis}`)).toEqual([
        'main:throughput:left',
        'compare:cpu:right',
      ]);
      expect(body.data.unit).toBe('rps');
      expect(body.data.stats).toMatchObject({ current: 2.5, peak: 2.5 });
    });
  });
});
