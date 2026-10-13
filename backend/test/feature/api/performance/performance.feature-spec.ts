import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { sample, stubPrometheus } from '../../../concerns/prometheus.concern.js';
import {
  PERFORMANCE_ROUTES,
  PerformanceEventsService,
  PerformanceMonitorService,
  PerformanceService,
} from '@modules/performance/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${PERFORMANCE_ROUTES.PREFIX}`;

/** P95 của API (giây) — test đổi giá trị này để tạo / gỡ điểm nghẽn. */
let p95Sec = 0.12;

/**
 * Prometheus giả (mọi cửa sổ như nhau): 2 req/s ngoài route nội bộ, 5% 5xx, trung bình 50 ms, p95 theo `p95Sec`,
 * CPU 35%, RSS 256 MB. Không có số đo database / cache / worker / messaging.
 */
function promql(expr: string) {
  const http = 'http_request_duration_seconds';
  if (expr.startsWith('histogram_quantile(0.95, sum by (le) (rate(' + http))
    return [sample(p95Sec)];
  if (expr.startsWith(`sum(increase(${http}_count{status=~"5..",`)) return [sample(90)];
  if (expr.startsWith(`sum(increase(${http}_count{`)) return [sample(1800)];
  if (expr.startsWith(`sum(increase(${http}_sum{`)) return [sample(90)];
  if (expr.startsWith('sum(rate(process_cpu_seconds_total')) return [sample(35)];
  if (expr.startsWith('sum(avg_over_time(process_resident_memory_bytes'))
    return [sample(256 * 1024 * 1024)];
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

    it('component detail: không có số đo → unavailable (không báo normal giả); 404 và validation', async () => {
      const api = await get<{ status: string; metrics: { value: unknown }[] }>(
        `${base}/components/api?range=15m`,
      );
      expect(api.status).toBe(200);
      expect(api.body.data).toMatchObject({ status: 'unavailable' });
      expect(api.body.data.metrics.every((m) => m.value === null)).toBe(true);

      const missing = await get(`${base}/components/nope`, { 'accept-language': 'en' });
      expect(missing.status).toBe(404);
      expect(missing.body.error?.message).toBe('Component nope does not exist.');
      expect((await get(`${base}/overview?range=30d`)).status).toBe(400);
      expect((await get(`${base}/timeseries?metric=disk`)).status).toBe(400);
    });

    it('bottlenecks rỗng (không kết luận khi không có số liệu); events trả về danh sách', async () => {
      expect(await context.app.get(PerformanceService).getBottlenecks()).toEqual([]);
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
        range: (expr, offsetSec) => [
          {
            labels: {},
            points: expr.includes('process_cpu')
              ? [{ t: 1_000, v: 30 }]
              : offsetSec > 0
                ? [{ t: 1_000, v: 1 }]
                : [
                    { t: 1_000, v: 1.5 },
                    { t: 2_000, v: 2.5 },
                  ],
          },
        ],
      });
    });

    afterAll(() => restore());

    it('overview: KPI, budget theo cấu hình; thành phần không có số liệu → unavailable', async () => {
      p95Sec = 0.12;
      const { status, body } = await get<{
        status: { level: string };
        telemetry: { database: string };
        kpis: {
          apiP95Ms: { value: number; changePercent: number | null };
          throughputPerSec: { value: number };
          cpuPercent: { value: number };
          memoryMb: { value: number; limitMb: number | null; percent: number | null };
          errorRatePercent: { value: number };
        };
        breakdown: { requests: number; avgTotalMs: number | null; phases: unknown[] };
        components: { id: string; status: string; note: string | null; load: number | null }[];
        budgets: { key: string; target: number; met: boolean | null }[];
      }>(`${base}/overview?range=15m`, { 'accept-language': 'en' });
      expect(status).toBe(200);
      const d = body.data;
      // 5% lỗi 5xx ≥ ngưỡng cảnh báo PERF_ERROR_RATE_PERCENT_WARN (2%) → degraded.
      expect(d.status.level).toBe('degraded');
      expect(d.kpis.apiP95Ms).toMatchObject({ value: 120, changePercent: 0 });
      expect(d.kpis.throughputPerSec.value).toBe(2);
      expect(d.kpis.errorRatePercent.value).toBe(5);
      expect(d.kpis.cpuPercent.value).toBe(35);
      expect(d.kpis.memoryMb).toMatchObject({ value: 256, limitMb: null, percent: null });
      // Prometheus không có thời gian theo giai đoạn → không chia ước lượng.
      expect(d.breakdown).toMatchObject({ requests: 1800, avgTotalMs: 50, phases: [] });
      expect(d.telemetry.database).toBe('unavailable');

      expect(d.components.find((c) => c.id === 'api')).toMatchObject({
        status: 'degraded',
        load: 2,
      });
      expect(d.components.find((c) => c.id === 'database')).toMatchObject({
        status: 'unavailable',
        note: 'Database is not connected — queries cannot be measured',
      });
      for (const id of ['cache', 'worker', 'messaging'])
        expect(d.components.find((c) => c.id === id)).toMatchObject({
          status: 'unavailable',
          note: 'No data in Prometheus for this time range',
          load: null,
        });
      expect(d.budgets.find((b) => b.key === 'apiP95Ms')).toMatchObject({ target: 200, met: true });
      expect(d.budgets.find((b) => b.key === 'errorRatePercent')!.met).toBe(false);
    });

    it('bottlenecks: P95 vượt ngưỡng → điểm nghẽn có tiêu đề và link drill-down', async () => {
      p95Sec = 1.5;
      const { body } = await get<{
        bottlenecks: {
          id: string;
          severity: string;
          title: string;
          value: number;
          target: string;
        }[];
      }>(`${base}/overview?range=15m`, { 'accept-language': 'en' });
      expect(body.data.bottlenecks[0]).not.toHaveProperty('runtime');
      expect(body.data.bottlenecks[0]).toMatchObject({
        id: 'API_LATENCY_P95',
        severity: 'critical',
        value: 1500,
        title: 'High API P95',
        target: 'http-traffic/endpoints?sort=p95',
      });
      p95Sec = 0.12;
    });

    it('monitor ghi sự kiện bắt đầu và hồi phục; events trả về đúng thứ tự', async () => {
      const monitor = context.app.get(PerformanceMonitorService);
      const store = context.app.get(PerformanceEventsService);
      p95Sec = 1.5;
      await monitor.tick(Date.now());
      await store.client.del(store.keys.evaluateLock());
      p95Sec = 0.12;
      await monitor.tick(Date.now() + 60_000);
      const { body } = await get<{ source: string; severity: string; title: string }[]>(
        `${base}/events?range=1h`,
        { 'accept-language': 'en' },
      );
      const p95 = body.data.filter((e) => e.source === 'performance' && e.title === 'High API P95');
      // Mới nhất trước: hồi phục (success) rồi bắt đầu (critical).
      expect(p95.map((e) => e.severity)).toEqual(['success', 'critical']);
      // Lỗi 5xx vẫn vượt ngưỡng → chỉ có sự kiện bắt đầu, chưa hồi phục.
      const err = body.data.filter((e) => e.title === 'High API error rate');
      expect(err).toHaveLength(1);
      expect(err[0]!.severity).not.toBe('success');
    });

    it('timeseries: series chính + so sánh (trục phải) + baseline hôm qua dịch về khoảng hiện tại', async () => {
      const { status, body } = await get<{
        series: { id: string; axis: string; kind: string; points: { t: number }[] }[];
        stats: { current: number | null; peak: number | null };
        unit: string;
        baselineUnavailable: boolean;
      }>(`${base}/timeseries?range=15m&metric=throughput&compare=cpu&baseline=yesterday`);
      expect(status).toBe(200);
      expect(body.data.series.map((s) => `${s.kind}:${s.id}:${s.axis}`)).toEqual([
        'main:throughput:left',
        'compare:cpu:right',
        'baseline:baseline:yesterday:left',
      ]);
      expect(body.data.series[2]!.points[0]!.t).toBe(1_000 + 86_400_000);
      expect(body.data.unit).toBe('rps');
      expect(body.data.baselineUnavailable).toBe(false);
      expect(body.data.stats).toMatchObject({ current: 2.5, peak: 2.5 });
    });
  });
});
