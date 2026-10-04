import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { SCHEDULER_OPS_ROUTES } from '@modules/scheduler-ops/index.js';
import { RedisService } from '@packages/redis/index.js';

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
      'scheduler:definitions',
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

  it('GET /overview — trả về tổng quan scheduler', async () => {
    const { status, body } = await call<any>('GET', `${base}/overview?range=24h`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.health.status).toBe('healthy');
    expect(body.data.kpis.registered).toBeGreaterThanOrEqual(1);
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

    const isMember = await redis.client.sismember('scheduler:disabled', 'system.maintenance');
    expect(isMember).toBe(1);

    const enRes = await call<any>('POST', `${base}/tasks/system.maintenance/enable`);
    expect(enRes.status).toBe(200);
    expect(enRes.body.success).toBe(true);
    expect(enRes.body.data.action).toBe('enable');

    const isMemberAfter = await redis.client.sismember('scheduler:disabled', 'system.maintenance');
    expect(isMemberAfter).toBe(0);
  });
});
