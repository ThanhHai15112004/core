import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { DATABASE_OPS_ROUTES } from '@modules/database-ops/index.js';

interface Envelope<T> {
  success: boolean;
  statusCode: number;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${DATABASE_OPS_ROUTES.PREFIX}`;

/** Test không có database thật: API vẫn chạy, các phần trả trạng thái "chưa kết nối" thay vì số giả. */
describe('Database Monitor (/ops/database) — không có database', () => {
  let context: TestAppContext;

  const call = async <T>(
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await context.app.inject({
      method,
      url,
      headers,
      ...(payload ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  it('overview: health không phải healthy, từng phần báo disconnected, không có số giả', async () => {
    const { status, body } = await call<{
      health: { status: string; reasons: { code: string }[] };
      server: { available: boolean; reason?: string };
      liveQueries: { available: boolean; reason?: string };
      kpis: { sessions: number | null; queriesPerSec: number | null; sizeBytes: number | null };
      capabilities: string[];
      driver: string;
    }>('GET', `${base}/overview?range=15m`);
    expect(status).toBe(200);
    expect(['unknown', 'unavailable', 'reconnecting']).toContain(body.data.health.status);
    expect(body.data.server).toMatchObject({ available: false, reason: 'disconnected' });
    expect(body.data.liveQueries).toMatchObject({ available: false, reason: 'disconnected' });
    expect(body.data.kpis.sessions).toBeNull();
    expect(body.data.kpis.sizeBytes).toBeNull();
    expect(body.data.driver).toBe('postgres');
    expect(body.data.capabilities).toContain('sessions');
  });

  it('config che mật khẩu', async () => {
    const { body } = await call<{ items: { key: string; value: unknown; sensitive?: boolean }[] }>(
      'GET',
      `${base}/config`,
    );
    const password = body.data.items.find((i) => i.key === 'password')!;
    expect(password).toEqual({ key: 'password', value: true, sensitive: true });
    expect(JSON.stringify(body.data)).not.toContain('test_password');
  });

  it('thao tác cần body xác nhận; chưa kết nối → 503; migration mặc định tắt', async () => {
    expect(
      (await call('POST', `${base}/connections/12/terminate`, { confirm: 'yes' })).status,
    ).toBe(400);
    expect(
      (await call('POST', `${base}/connections/abc/terminate`, { confirm: 'TERMINATE' })).status,
    ).toBe(400);
    const terminate = await call('POST', `${base}/connections/12/terminate`, {
      confirm: 'TERMINATE',
    });
    expect(terminate.status).toBe(503);
    expect(terminate.body.error?.code).toBe('DATABASE_NOT_CONNECTED');
    const migrate = await call(
      'POST',
      `${base}/migrations/run`,
      { confirm: 'MIGRATE' },
      { 'accept-language': 'en' },
    );
    expect(migrate.status).toBe(409);
    expect(migrate.body.error?.code).toBe('DATABASE_MIGRATIONS_DISABLED');
    expect(migrate.body.error?.message).toContain('OPS_DATABASE_MIGRATIONS_ENABLED');
  });

  it('ping trả lỗi thật thay vì thành công giả; validation range/metric', async () => {
    const ping = await call<{ ok: boolean; latencyMs: number | null }>('POST', `${base}/ping`);
    expect(ping.status).toBe(200);
    expect(ping.body.data).toMatchObject({ ok: false, latencyMs: null });
    expect((await call('GET', `${base}/metrics?metric=disk`)).status).toBe(400);
    expect((await call('GET', `${base}/overview?range=7d`)).status).toBe(400);
    const metrics = await call<{ series: unknown[] }>(
      'GET',
      `${base}/metrics?range=1h&metric=latency`,
    );
    expect(metrics.status).toBe(200);
  });
});
