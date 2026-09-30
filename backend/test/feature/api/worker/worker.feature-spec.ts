import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import {
  QUEUE_OPS_ROUTES,
  WORKER_OPS_ROUTES,
  WorkerMonitorService,
} from '@modules/worker-ops/index.js';
import { RedisService } from '@packages/redis/index.js';
import { recordQueueOperation } from '@packages/queue/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const workers = `/${WORKER_OPS_ROUTES.PREFIX}`;
const queues = `/${QUEUE_OPS_ROUTES.PREFIX}`;

/**
 * Worker & Queue khi backend queue không tới được (test trỏ BullMQ vào cổng đóng — xem test/setup-env.ts):
 * trang vẫn trả lời và nói rõ trạng thái thay vì số liệu giả; thao tác bị chặn; cảnh báo backend unavailable.
 */
describe('Worker & Queue (/ops/workers, /ops/queues) — backend unavailable', () => {
  let context: TestAppContext;

  const call = async <T>(method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const res = await context.app.inject({
      method,
      url,
      headers: { 'accept-language': 'en' },
      ...(payload ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
    const redis = context.app.get(RedisService);
    await recordQueueOperation(redis, {
      at: Date.now(),
      action: 'pause',
      target: 'system.events',
      result: 'success',
      detail: 'active=0, waiting=3',
      durationMs: 4,
      actor: null,
      ip: '10.0.0.x',
      error: null,
    });
    await context.app.get(WorkerMonitorService).tick();
  });

  afterAll(async () => {
    await context.close();
  });

  it('overview: provider BullMQ, background processing down, số liệu queue có lý do "disconnected"', async () => {
    const { status, body } = await call<{
      provider: { driver: string; product: string; backend: string; endpoint: string };
      health: { status: string; state: string; reasons: { code: string }[] };
      kpis: { waiting: number | null; workers: number; retrying: number | null };
      queues: { available: boolean; reason: string };
      alerts: { rule: string; severity: string }[];
      events: { type: string }[];
      settings: { pause: boolean; retryFailed: boolean; drain: boolean };
    }>('GET', `${workers}/overview?range=15m`);
    expect(status).toBe(200);
    expect(body.data.provider).toMatchObject({
      driver: 'bullmq',
      product: 'BullMQ',
      backend: 'Redis',
    });
    expect(body.data.provider.endpoint).not.toContain('@');
    expect(body.data.health).toMatchObject({ status: 'down', state: 'unavailable' });
    expect(body.data.health.reasons[0]!.code).toBe('unavailable');
    expect(body.data.queues).toMatchObject({ available: false, reason: 'disconnected' });
    expect(body.data.kpis).toMatchObject({ waiting: null, workers: 0, retrying: null });
    expect(body.data.alerts).toEqual([
      expect.objectContaining({ rule: 'BROKER_UNAVAILABLE', severity: 'critical' }),
    ]);
    expect(body.data.events.map((e) => e.type)).toContain('alert_started');
    // Drain mặc định tắt.
    expect(body.data.settings).toMatchObject({ pause: true, retryFailed: true, drain: false });
  });

  it('workers / queues / failures / delayed / metrics trả lời được khi backend mất', async () => {
    const w = await call<{ workers: unknown[]; brokerWorkers: number | null }>('GET', workers);
    expect(w.status).toBe(200);
    expect(w.body.data).toMatchObject({ workers: [], brokerWorkers: null });
    const q = await call<{ queues: { available: boolean; reason: string } }>('GET', queues);
    expect(q.body.data.queues).toMatchObject({ available: false, reason: 'disconnected' });
    const f = await call<{ retrying: { reason: string }; stats: { deadLetter: number | null } }>(
      'GET',
      `${workers}/failures?range=1h`,
    );
    expect(f.body.data.retrying.reason).toBe('disconnected');
    expect(f.body.data.stats.deadLetter).toBeNull();
    const d = await call<{ total: number | null; jobs: { available: boolean } }>(
      'GET',
      `${workers}/delayed`,
    );
    expect(d.body.data).toMatchObject({ total: null, jobs: { available: false } });
    const m = await call<{ metric: string; queue: string }>(
      'GET',
      `${queues}/system.events/metrics?metric=waiting&range=6h`,
    );
    expect(m.body.data).toMatchObject({ metric: 'waiting', queue: 'system.events' });
    expect((await call('GET', `${workers}/metrics?metric=nope`)).status).toBe(400);
  });

  it('chi tiết queue → 503 khi mất kết nối; queue / worker lạ → 404', async () => {
    const detail = await call('GET', `${queues}/system.events`);
    expect(detail.status).toBe(503);
    expect(detail.body.error?.code).toBe('QUEUE_NOT_CONNECTED');
    expect((await call('GET', `${queues}/nope`)).status).toBe(404);
    expect((await call('GET', `${queues}/nope/jobs`)).status).toBe(404);
    const worker = await call('GET', `${workers}/worker@host:1`);
    expect(worker.status).toBe(404);
    expect(worker.body.error?.code).toBe('WORKER_RESOURCE_NOT_FOUND');
    expect((await call('GET', `${queues}/system.events/jobs?state=bogus`)).status).toBe(400);
  });

  it('thao tác: mất kết nối → 503; drain cần gõ DRAIN và đang tắt; retry cần count hợp lệ', async () => {
    const pause = await call('POST', `${queues}/system.events/pause`);
    expect(pause.status).toBe(503);
    expect((await call('POST', `${queues}/system.events/drain`, {})).status).toBe(400);
    const drain = await call('POST', `${queues}/system.events/drain`, { confirm: 'DRAIN' });
    expect(drain.status).toBe(409);
    expect(drain.body.error?.code).toBe('QUEUE_DRAIN_DISABLED');
    expect((await call('POST', `${queues}/system.events/retry-failed`, { count: 0 })).status).toBe(
      400,
    );
  });

  it('sự kiện, audit và cấu hình', async () => {
    const e = await call<{ type: string; severity: string }[]>('GET', `${workers}/events?range=1h`);
    expect(e.body.data[0]).toMatchObject({ type: 'alert_started', severity: 'critical' });
    const ops = await call<{ action: string; target: string }[]>('GET', `${workers}/operations`);
    expect(ops.body.data[0]).toMatchObject({ action: 'pause', target: 'system.events' });
    const c = await call<{ items: { key: string; value: unknown }[] }>('GET', `${workers}/config`);
    const item = (k: string) => c.body.data.items.find((i) => i.key === k)?.value;
    expect(item('driver')).toBe('bullmq');
    expect(item('drain')).toBe(false);
    expect(item('backlogWarn')).toBe(1000);
  });
});
