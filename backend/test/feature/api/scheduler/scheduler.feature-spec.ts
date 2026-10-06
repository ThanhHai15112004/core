import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { SCHEDULER_OPS_ROUTES } from '@modules/scheduler-ops/index.js';
import { RedisService } from '@packages/redis/index.js';
import { schedulerKeys } from '@packages/queue/index.js';
import { runtimeKeys } from '@packages/runtime/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${SCHEDULER_OPS_ROUTES.PREFIX}`;

describe('Scheduler (/ops/scheduler)', () => {
  let context: TestAppContext;
  let redis: RedisService;

  const call = async <T>(method: 'GET' | 'POST', url: string) => {
    const res = await context.app.inject({ method, url, headers: { 'accept-language': 'en' } });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
    redis = context.app.get(RedisService);

    // Lưu định nghĩa task vào Redis giống như ScheduleSyncService làm
    await redis.client.hset(
      schedulerKeys(redis).definitions(),
      'system.maintenance',
      JSON.stringify({
        id: 'system.maintenance',
        queue: 'system.events',
        name: 'system.maintenance.tick',
        description: 'Periodic maintenance tick',
        pattern: '*/10 * * * *',
        tz: 'UTC',
      }),
    );
  });

  afterAll(async () => {
    await context.close();
  });

  it('GET /overview — chưa có heartbeat → down (không báo healthy giả); có heartbeat → instance thật', async () => {
    const first = await call<any>('GET', `${base}/overview?range=24h`);
    expect(first.status).toBe(200);
    expect(first.body.data.health.status).toBe('down');
    expect(first.body.data.health.reasons[0].code).toBe('neverStarted');
    expect(first.body.data.instance).toBeNull();
    expect(first.body.data.kpis.registered).toBeGreaterThanOrEqual(1);
    // Broker không kết nối trong test → không có lần chạy nào, tỉ lệ thành công không bịa 100%.
    expect(first.body.data.kpis.successRatePercent).toBeNull();

    await redis.client.set(
      runtimeKeys(redis).heartbeat('scheduler'),
      JSON.stringify({
        instance: 'sched-host:4242',
        state: 'running',
        at: new Date().toISOString(),
        startedAt: new Date(Date.now() - 120_000).toISOString(),
        uptimeSec: 120,
        process: { hostname: 'sched-host', pid: 4242 },
      }),
    );
    const second = await call<any>('GET', `${base}/overview?range=24h`);
    expect(second.body.data.health.status).toBe('healthy');
    expect(second.body.data.instance).toMatchObject({
      host: 'sched-host',
      pid: 4242,
      uptimeSec: 120,
    });
  });

  it('GET /tasks — trả về danh sách task', async () => {
    const { status, body } = await call<any>('GET', `${base}/tasks`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const found = body.data.tasks.find((t: any) => t.id === 'system.maintenance');
    expect(found).toBeDefined();
    expect(found.enabled).toBe(true);
    expect(found.schedule.type).toBe('cron');
  });

  it('GET /cron — thẩm định biểu thức cron', async () => {
    const { status, body } = await call<any>(
      'GET',
      `${base}/cron?expression=${encodeURIComponent('*/15 * * * *')}&timezone=UTC`,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.valid).toBe(true);
    expect(body.data.next.length).toBe(5);
  });

  it('GET /config — trả về cấu hình scheduler', async () => {
    const { status, body } = await call<any>('GET', `${base}/config`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items).toBeDefined();
  });

  it('POST /tasks/:id/disable và enable — bật tắt task', async () => {
    const disRes = await call<any>('POST', `${base}/tasks/system.maintenance/disable`);
    expect(disRes.status).toBe(200);
    expect(disRes.body.success).toBe(true);
    expect(disRes.body.data.action).toBe('disable');

    const isMember = await redis.client.sismember(
      schedulerKeys(redis).disabled(),
      'system.maintenance',
    );
    expect(isMember).toBe(1);

    const enRes = await call<any>('POST', `${base}/tasks/system.maintenance/enable`);
    expect(enRes.status).toBe(200);
    expect(enRes.body.success).toBe(true);
    expect(enRes.body.data.action).toBe('enable');

    const isMemberAfter = await redis.client.sismember(
      schedulerKeys(redis).disabled(),
      'system.maintenance',
    );
    expect(isMemberAfter).toBe(0);
  });
});
