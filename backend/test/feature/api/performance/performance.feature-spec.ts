import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { PERFORMANCE_ROUTES } from '@modules/performance/index.js';
import { RedisService } from '@packages/redis/index.js';
import { TrafficCollectorService } from '@packages/traffic/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { BaseCacheProvider } from '@packages/cache/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${PERFORMANCE_ROUTES.PREFIX}`;

describe('Performance (/ops/performance)', () => {
  let context: TestAppContext;

  const get = async <T>(url: string, headers: Record<string, string> = {}) => {
    const res = await context.app.inject({ method: 'GET', url, headers });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
    await context.app.get(RedisService).client.flushall();
    // Tải thật: request HTTP (đi tới handler → có breakdown), thao tác cache, mẫu CPU của runtime API.
    for (let i = 0; i < 5; i++) await context.app.inject({ method: 'GET', url: '/health' });
    const cache = context.app.get(BaseCacheProvider);
    await cache.set('k', 1);
    await cache.get('k');
    await cache.get('missing');
    const recorder = context.app.get(MetricRecorder);
    recorder.gauge('rt.cpu', 12);
    recorder.gauge('rt.rss', 150);
    await context.app.get(TrafficCollectorService).flush();
    await recorder.flush();
  });

  afterAll(async () => {
    await context.close();
  });

  it('overview: KPI, breakdown theo giai đoạn, thành phần thật / không khả dụng', async () => {
    const { status, body } = await get<{
      status: { level: string };
      telemetry: { database: string };
      kpis: {
        throughputPerSec: { value: number };
        cpuPercent: { value: number };
        apiP95Ms: { value: number };
      };
      breakdown: { requests: number; phases: { phase: string; avgMs: number }[] };
      components: { id: string; status: string; note: string | null }[];
      throughput: { httpPerSec: number; cacheOpsPerSec: number; dbQueriesPerSec: number | null };
      budgets: { key: string; met: boolean | null }[];
    }>(`${base}/overview?range=15m`);
    expect(status).toBe(200);
    const d = body.data;
    expect(d.status.level).toBe('normal');
    expect(d.kpis.throughputPerSec.value).toBeGreaterThan(0);
    // Gồm cả mẫu thật do runtime agent ghi lúc khởi động.
    expect(d.kpis.cpuPercent.value).not.toBeNull();
    expect(d.breakdown.requests).toBe(5);
    expect(d.breakdown.phases.map((p) => p.phase)).toEqual([
      'route',
      'guard',
      'app',
      'db',
      'cache',
      'send',
    ]);
    // Không có TypeORM DataSource → database không khả dụng, không có số giả.
    expect(d.telemetry.database).toBe('no-datasource');
    const db = d.components.find((c) => c.id === 'database')!;
    expect(db.status).toBe('unavailable');
    expect(d.throughput.dbQueriesPerSec).toBeNull();
    expect(d.components.find((c) => c.id === 'cache')!.status).toBe('normal');
    expect(d.components.find((c) => c.id === 'api')!.status).toBe('normal');
    expect(d.throughput.cacheOpsPerSec).toBeGreaterThan(0);
    expect(d.budgets.find((b) => b.key === 'apiP95Ms')!.met).toBe(true);
  });

  it('timeseries: series chính + so sánh (trục phải) + baseline', async () => {
    const { status, body } = await get<{
      series: { id: string; axis: string; kind: string; points: { value: number }[] }[];
      stats: { current: number | null };
      unit: string;
    }>(`${base}/timeseries?range=15m&metric=throughput&compare=cpu&baseline=previous`);
    expect(status).toBe(200);
    const kinds = body.data.series.map((s) => `${s.kind}:${s.id}`);
    expect(kinds[0]).toBe('main:http');
    expect(kinds).toContain('compare:compare:total');
    expect(body.data.series.find((s) => s.kind === 'compare')!.axis).toBe('right');
    expect(body.data.unit).toBe('/s');
    expect(body.data.stats.current).toBeGreaterThan(0);
  });

  it('component detail, 404 và validation', async () => {
    const api = await get<{
      id: string;
      endpoints: { route: string }[];
      metrics: { key: string }[];
    }>(`${base}/components/api?range=15m`);
    expect(api.status).toBe(200);
    expect(api.body.data.endpoints.map((e) => e.route)).toContain('/health');
    expect(api.body.data.metrics.map((m) => m.key)).toContain('p95');

    const missing = await get(`${base}/components/nope`, { 'accept-language': 'en' });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.message).toBe('Component nope does not exist.');
    expect((await get(`${base}/overview?range=30d`)).status).toBe(400);
    expect((await get(`${base}/timeseries?metric=disk`)).status).toBe(400);
  });

  it('events và bottlenecks trả về danh sách (rỗng khi hệ thống khỏe)', async () => {
    expect((await get<unknown[]>(`${base}/bottlenecks`)).body.data).toEqual([]);
    const events = await get<unknown[]>(`${base}/events?range=1h`);
    expect(events.status).toBe(200);
    expect(Array.isArray(events.body.data)).toBe(true);
  });

  it('Redis không sẵn sàng → 503 telemetry unavailable', async () => {
    const client = context.app.get(RedisService).client;
    Object.defineProperty(client, 'status', { value: 'reconnecting', configurable: true });
    try {
      const res = await get(`${base}/overview`);
      expect(res.status).toBe(503);
      expect(res.body.error?.code).toBe('PERFORMANCE_TELEMETRY_UNAVAILABLE');
    } finally {
      Object.defineProperty(client, 'status', { value: 'ready', configurable: true });
    }
  });
});
