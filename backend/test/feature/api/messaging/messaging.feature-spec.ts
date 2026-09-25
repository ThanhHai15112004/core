import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { MESSAGING_OPS_ROUTES, MessagingMonitorService } from '@modules/messaging-ops/index.js';
import { RedisService } from '@packages/redis/index.js';
import { messagingKeys, recordMessagingError } from '@packages/messaging/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${MESSAGING_OPS_ROUTES.PREFIX}`;

/**
 * Messaging Monitor khi broker không tới được (test trỏ BullMQ vào cổng đóng — xem test/setup-env.ts):
 * trang vẫn trả lời, nói rõ lý do thay vì số liệu giả; thao tác bị chặn; cảnh báo broker unavailable.
 */
describe('Messaging Monitor (/ops/messaging) — broker unavailable', () => {
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
    const keys = messagingKeys(redis);
    // Registry channel do publisher ghi + một lỗi consume như worker ghi.
    await redis.client.hset(
      keys.channels(),
      'scheduler:system.maintenance.tick',
      JSON.stringify({ queue: 'system.events', lastPublishedAt: Date.now() }),
    );
    await recordMessagingError(redis, {
      at: Date.now(),
      stage: 'consume',
      kind: 'timeout',
      channel: 'system.maintenance.tick',
      queue: 'system.events',
      messageId: 'msg-1',
      consumer: 'SystemProcessor',
      runtime: 'worker',
      attempt: 3,
      maxAttempts: 3,
      final: true,
      code: null,
      message: 'StorageTimeout',
      correlationId: 'corr-1',
    });
    await context.app.get(MessagingMonitorService).tick();
  });

  afterAll(async () => {
    await context.close();
  });

  it('overview: provider BullMQ, broker unavailable, số liệu broker có lý do "disconnected"', async () => {
    const { status, body } = await call<{
      provider: { driver: string; product: string; broker: string; endpoint: string };
      health: { status: string; state: string };
      kpis: { lag: number | null; deadLetter: number | null; channels: number };
      queues: { available: boolean; reason: string };
      alerts: { rule: string; severity: string }[];
      events: { type: string }[];
      settings: { replay: boolean; payload: boolean };
    }>('GET', `${base}/overview?range=15m`);
    expect(status).toBe(200);
    expect(body.data.provider).toMatchObject({
      driver: 'bullmq',
      product: 'BullMQ',
      broker: 'Redis',
    });
    expect(body.data.provider.endpoint).not.toContain('@');
    expect(body.data.health).toMatchObject({ status: 'unavailable', state: 'unavailable' });
    expect(body.data.queues).toMatchObject({ available: false, reason: 'disconnected' });
    expect(body.data.kpis).toMatchObject({ deadLetter: null, channels: 1 });
    expect(body.data.alerts).toEqual([
      expect.objectContaining({ rule: 'BROKER_UNAVAILABLE', severity: 'critical' }),
    ]);
    expect(body.data.events.map((e) => e.type)).toContain('alert_started');
  });

  it('channels / producers / consumers / metrics trả lời được khi broker mất', async () => {
    const ch = await call<{
      channels: { channel: string; queue: string; producers: string[]; lag: null }[];
    }>('GET', `${base}/channels`);
    expect(ch.body.data.channels).toEqual([
      expect.objectContaining({
        channel: 'system.maintenance.tick',
        queue: 'system.events',
        producers: ['scheduler'],
        lag: null,
      }),
    ]);
    const pr = await call<{ producers: { producer: string }[] }>('GET', `${base}/producers`);
    expect(pr.body.data.producers.map((p) => p.producer)).toEqual(['scheduler']);
    const co = await call<{ consumers: unknown[] }>('GET', `${base}/consumers`);
    expect(co.status).toBe(200);
    const m = await call<{ metric: string; series: unknown[] }>(
      'GET',
      `${base}/metrics?metric=lag&range=1h`,
    );
    expect(m.body.data.metric).toBe('lag');
    const bad = await call('GET', `${base}/metrics?metric=nope`);
    expect(bad.status).toBe(400);
  });

  it('lỗi & sự kiện; config không lộ mật khẩu', async () => {
    const e = await call<{ items: { messageId: string; kind: string; final: boolean }[] }>(
      'GET',
      `${base}/errors?range=1h`,
    );
    expect(e.body.data.items[0]).toMatchObject({
      messageId: 'msg-1',
      kind: 'timeout',
      final: true,
    });
    const c = await call<{ items: { key: string; value: unknown; sensitive?: boolean }[] }>(
      'GET',
      `${base}/config`,
    );
    const cred = c.body.data.items.find((i) => i.key === 'credentials');
    expect(cred).toMatchObject({ sensitive: true });
    expect(typeof cred?.value).toBe('boolean');
    expect(c.body.data.items.find((i) => i.key === 'maxAttempts')?.value).toBe(3);
  });

  it('messages: section disconnected; chi tiết → 503', async () => {
    const list = await call<{ messages: { available: boolean; reason: string } }>(
      'GET',
      `${base}/messages?status=dead_letter`,
    );
    expect(list.body.data.messages).toMatchObject({ available: false, reason: 'disconnected' });
    const detail = await call('GET', `${base}/messages/msg-1`);
    expect(detail.status).toBe(503);
    expect(detail.body.error?.code).toBe('MESSAGING_NOT_CONNECTED');
    const badStatus = await call('GET', `${base}/messages?status=weird`);
    expect(badStatus.status).toBe(400);
  });

  it('thao tác: cần xác nhận đúng; broker mất → 503', async () => {
    const noConfirm = await call('POST', `${base}/dead-letter/msg-1/replay`, {
      queue: 'system.events',
    });
    expect(noConfirm.status).toBe(400);
    const replay = await call('POST', `${base}/dead-letter/msg-1/replay`, {
      queue: 'system.events',
      confirm: 'REPLAY',
    });
    expect(replay.status).toBe(503);
    const wrongWord = await call('DELETE', `${base}/dead-letter/msg-1`, {
      queue: 'system.events',
      confirm: 'DELETE',
    });
    expect(wrongWord.status).toBe(400);
    const retry = await call('POST', `${base}/messages/msg-1/retry`, { queue: 'system.events' });
    expect(retry.status).toBe(503);
  });

  it('Test Broker thất bại ở bước connect và được ghi audit', async () => {
    const { body } = await call<{
      ok: boolean;
      failedStep: string;
      steps: { step: string; ok: boolean }[];
    }>('POST', `${base}/test`);
    expect(body.data).toMatchObject({ ok: false, failedStep: 'connect' });
    const ops = await call<{ action: string; result: string }[]>('GET', `${base}/operations`);
    expect(ops.body.data[0]).toMatchObject({ action: 'test', result: 'failed' });
  });

  it('Package Registry: messaging có trạng thái thật', async () => {
    const { body } = await call<{ statusReport: { status: string; metrics: { driver: string } } }>(
      'GET',
      '/ops/packages/messaging',
    );
    expect(body.data.statusReport).toMatchObject({
      status: 'error',
      metrics: { driver: 'bullmq' },
    });
  });
});
