import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { sample, stubPrometheus } from '../../../concerns/prometheus.concern.js';
import { MESSAGING_OPS_ROUTES, MessagingMonitorService } from '@modules/messaging-ops/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${MESSAGING_OPS_ROUTES.PREFIX}`;

const CH = { queue: 'system.events', channel: 'user.created' };

/** Prometheus giả: 30 publish (+2 lỗi), 27 consume (+3 lỗi), 4 retry, 1 vào Dead Letter, 2 phục hồi. */
function promql(expr: string) {
  if (expr.startsWith('sum by (queue, channel, result) (increase(messages_published_total'))
    return [sample(30, { ...CH, result: 'success' }), sample(2, { ...CH, result: 'failed' })];
  if (expr.startsWith('sum by (queue, channel, result) (increase(messages_consumed_total'))
    return [sample(27, { ...CH, result: 'success' }), sample(3, { ...CH, result: 'failed' })];
  if (expr.startsWith('sum by (queue, channel, final)'))
    return [sample(4, { ...CH, final: 'false' }), sample(1, { ...CH, final: 'true' })];
  if (expr.startsWith('sum by (queue) (increase(job_recovered_total'))
    return [sample(2, { queue: CH.queue })];
  if (expr.startsWith('sum (increase(job_duration_seconds_sum')) return [sample(6)];
  if (expr.startsWith('sum (increase(job_duration_seconds_count')) return [sample(30)];
  if (expr.startsWith('histogram_quantile(0.95, sum by (le)')) return [sample(0.5)];
  return [];
}

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
    await context.app.get(MessagingMonitorService).tick();
  });

  afterAll(async () => {
    await context.close();
  });

  it('overview: provider BullMQ, broker unavailable, số liệu broker có lý do "disconnected"', async () => {
    const { status, body } = await call<{
      provider: { driver: string; product: string; broker: string; endpoint: string };
      health: { status: string; state: string };
      kpis: {
        lag: number | null;
        failed: number | null;
        deadLetter: number | null;
        channels: number;
      };
      delivery: unknown;
      report: { today: unknown; yesterday: unknown };
      queues: { available: boolean; reason: string };
      alerts: { rule: string; severity: string }[];
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
    // Không có Prometheus → số đếm theo thời gian là null, không phải 0.
    expect(body.data.kpis).toMatchObject({ failed: null, deadLetter: null, channels: 0 });
    expect(body.data.delivery).toBeNull();
    expect(body.data.report).toEqual({ today: null, yesterday: null });
    expect(body.data.alerts).toEqual([
      expect.objectContaining({ rule: 'BROKER_UNAVAILABLE', severity: 'critical' }),
    ]);
    const ev = await call<{ type: string }[]>('GET', `${base}/events?range=1h`);
    expect(ev.body.data.map((e) => e.type)).toContain('alert_started');
  });

  it('channels / consumers / metrics trả lời được khi broker mất; producers đã bỏ', async () => {
    const ch = await call<{ channels: unknown[] }>('GET', `${base}/channels`);
    expect(ch.body.data.channels).toEqual([]);
    const pr = await call('GET', `${base}/producers`);
    expect(pr.status).toBe(404);
    const co = await call<{ consumers: unknown[] }>('GET', `${base}/consumers`);
    expect(co.status).toBe(200);
    const m = await call<{ series: { id: string }[] }>('GET', `${base}/metrics?metric=lag&range=1h`);
    expect(m.status).toBe(200);
    expect(m.body.data.series[0]?.id).toBe('lag');
    const bad = await call('GET', `${base}/metrics?metric=nope`);
    expect(bad.status).toBe(400);
    const size = await call('GET', `${base}/metrics?metric=size`);
    expect(size.status).toBe(400);
  });

  it('lỗi đọc từ job lỗi của broker → broker mất thì nói rõ lý do; config không lộ mật khẩu', async () => {
    const e = await call<{
      counts: unknown;
      byStage: { publish: number | null; consume: number | null };
      items: { available: boolean; reason: string };
    }>('GET', `${base}/errors?range=1h`);
    expect(e.status).toBe(200);
    expect(e.body.data.items).toMatchObject({ available: false, reason: 'disconnected' });
    expect(e.body.data.counts).toBeNull();
    expect(e.body.data.byStage).toEqual({ publish: null, consume: null });
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

describe('Messaging Monitor (/ops/messaging) — số liệu từ Prometheus', () => {
  let context: TestAppContext;
  let restore: () => void;

  const get = async <T>(url: string) => {
    const res = await context.app.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
    restore = stubPrometheus(context.app, {
      query: promql,
      range: () => [{ labels: {}, points: [{ t: 1_000, v: 0.5 }] }],
    });
  });

  afterAll(async () => {
    restore();
    await context.close();
  });

  it('overview: delivery, tốc độ và thời gian xử lý lấy từ counter/histogram', async () => {
    const { status, body } = await get<{
      kpis: { publishedPerSec: number | null; failed: number | null };
      delivery: Record<string, number | null>;
      processing: { avgMs: number | null; p95Ms: number | null };
    }>(`${base}/overview?range=15m`);
    expect(status).toBe(200);
    expect(body.data.delivery).toEqual({
      published: 30,
      consumed: 27,
      retried: 4,
      deadLettered: 1,
      recovered: 2,
      failureRatePercent: 10,
    });
    expect(body.data.kpis).toMatchObject({ publishedPerSec: 0.033, failed: 5 });
    expect(body.data.processing).toMatchObject({ avgMs: 200, p95Ms: 500 });
  });

  it('channels: channel có lưu lượng trong Prometheus xuất hiện dù broker không có message chờ', async () => {
    const { body } = await get<{
      channels: { channel: string; queue: string | null; publishPerSec: number; lag: unknown }[];
    }>(`${base}/channels?range=15m`);
    expect(body.data.channels).toEqual([
      expect.objectContaining({
        channel: 'user.created',
        queue: 'system.events',
        publishPerSec: 0.033,
        lag: null,
      }),
    ]);
  });

  it('errors: số lần lỗi theo giai đoạn từ Prometheus', async () => {
    const { body } = await get<{ byStage: { publish: number; consume: number } }>(
      `${base}/errors?range=15m`,
    );
    expect(body.data.byStage).toEqual({ publish: 2, consume: 3 });
  });

  it('metrics: biểu đồ đọc bằng range query', async () => {
    const { body } = await get<{
      series: { id: string; points: { value: number }[] }[];
    }>(`${base}/metrics?metric=throughput&range=1h`);
    expect(body.data.series.map((x) => x.id)).toEqual(['published', 'consumed', 'failed']);
    expect(body.data.series[0]!.points).toEqual([{ t: 1_000, value: 0.5 }]);
  });
});
