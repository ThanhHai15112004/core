import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { JOBS_OPS_ROUTES } from '@modules/jobs-ops/index.js';
import { RedisService } from '@packages/redis/index.js';
import { recordJobEvent, recordJobOperation } from '@packages/messaging/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${JOBS_OPS_ROUTES.PREFIX}`;

/**
 * Jobs khi queue backend không tới được (test trỏ BullMQ vào cổng đóng — xem test/setup-env.ts): trang nói rõ
 * "unavailable", không dựng số job giả; tìm kiếm / chi tiết / thao tác trả 503; sự kiện, audit, cấu hình vẫn đọc được.
 */
describe('Jobs (/ops/jobs) — backend unavailable', () => {
  let context: TestAppContext;

  const call = async <T>(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
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
    await recordJobEvent(redis, {
      type: 'job_failed',
      severity: 'critical',
      jobId: '0a1b2c3d-1111-2222-3333-444455556666',
      queue: 'system.events',
      jobType: 'report.generate',
      params: { attempt: 3, maxAttempts: 3, error: 'StorageTimeout' },
      runtime: 'worker',
    });
    await recordJobOperation(redis, {
      at: Date.now(),
      action: 'retry',
      target: 'system.events|abc',
      jobType: 'report.generate',
      result: 'success',
      detail: 'attempt=4',
      reason: null,
      durationMs: 3,
      actor: null,
      ip: '10.0.0.x',
      error: null,
    });
  });

  afterAll(async () => {
    await context.close();
  });

  it('overview: status unavailable, KPI live = null (không giả), sự kiện đọc được', async () => {
    const { status, body } = await call<{
      status: string;
      kpis: {
        waiting: number | null;
        active: number | null;
        stalled: number | null;
        completedToday: number;
      };
      failureGroups: { available: boolean; reason: string };
      events: { type: string; message: string }[];
      provider: { product: string; connection: string };
      settings: { retry: boolean; remove: boolean };
      capabilities: string[];
    }>('GET', `${base}/overview?range=1h`);
    expect(status).toBe(200);
    expect(body.data.status).toBe('unavailable');
    expect(body.data.kpis).toMatchObject({
      waiting: null,
      active: null,
      stalled: null,
      completedToday: 0,
    });
    expect(body.data.failureGroups).toMatchObject({ available: false, reason: 'disconnected' });
    expect(body.data.provider.product).toBe('BullMQ');
    expect(body.data.capabilities).toEqual(
      expect.arrayContaining(['progress', 'stalled', 'cancel']),
    );
    expect(body.data.settings).toMatchObject({ retry: true, remove: false });
    expect(body.data.events[0]).toMatchObject({ type: 'job_failed' });
    expect(body.data.events[0]!.message).toContain('failed after 3/3');
  });

  it('search / detail / retry → 503 JOBS_UNAVAILABLE', async () => {
    const search = await call('GET', `${base}?status=failed&limit=20`);
    expect(search.status).toBe(503);
    expect(search.body.error?.code).toBe('JOBS_UNAVAILABLE');
    const detail = await call('GET', `${base}/abc?queue=system.events`);
    expect(detail.status).toBe(503);
    const retry = await call('POST', `${base}/abc/retry`, { queue: 'system.events' });
    expect(retry.status).toBe(503);
  });

  it('validation: trạng thái / queue sai', async () => {
    expect((await call('GET', `${base}?status=bogus`)).status).toBe(400);
    expect((await call('GET', `${base}/abc?queue=nope`)).status).toBe(404);
    expect((await call('POST', `${base}/retry`, { jobs: [] })).status).toBe(400);
  });

  it('remove mặc định tắt (kiểm tra quyền trước khi chạm broker)', async () => {
    const res = await call('DELETE', `${base}/abc?queue=system.events`);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('JOBS_REMOVE_DISABLED');
  });

  it('events / operations / config / report', async () => {
    const events = await call<{ type: string }[]>('GET', `${base}/events?range=1h`);
    expect(events.body.data.map((e) => e.type)).toEqual(['job_failed']);
    const ops = await call<{ action: string; target: string }[]>('GET', `${base}/operations`);
    expect(ops.body.data[0]).toMatchObject({ action: 'retry', target: 'system.events|abc' });
    const cfg = await call<{ items: { key: string; value: unknown }[] }>('GET', `${base}/config`);
    expect(cfg.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'lockDurationMs', value: 30000 }),
        expect.objectContaining({ key: 'remove', value: false }),
      ]),
    );
    const report = await call<{ today: { created: number }; types: unknown[] }>(
      'GET',
      `${base}/report?range=24h`,
    );
    expect(report.status).toBe(200);
    expect(report.body.data.today.created).toBe(0);
  });
});
