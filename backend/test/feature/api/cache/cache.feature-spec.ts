import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { CACHE_OPS_ROUTES } from '@modules/cache-ops/index.js';
import { BaseCacheProvider } from '@packages/cache/index.js';

interface Envelope<T> {
  success: boolean;
  statusCode: number;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${CACHE_OPS_ROUTES.PREFIX}`;

/** Cache Monitor trên Redis giả lập: số liệu thật từ key đã ghi qua BaseCacheProvider. */
describe('Cache Monitor (/ops/cache)', () => {
  let context: TestAppContext;
  let cache: BaseCacheProvider;

  const call = async <T>(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
    const res = await context.app.inject({
      method,
      url,
      headers: { 'accept-language': 'vi' },
      ...(payload ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    // Đặt rõ thay vì dựa vào .env local của máy dev (có thể đã bật flush).
    process.env['OPS_CACHE_VALUE_PREVIEW'] = 'true';
    process.env['OPS_CACHE_FLUSH_ENABLED'] = 'false';
    process.env['OPS_CACHE_ACTIONS_ENABLED'] = 'true';
    context = await createTestApp();
    cache = context.app.get(BaseCacheProvider);
    await cache.set('user:1', { name: 'An', password: 'hunter2', email: 'an@example.com' }, 600);
    await cache.set('user:2', { name: 'Binh' });
    await cache.set('auth:session:abcdefabcdefabcdef12', { uid: 1 }, 3600);
    await cache.set('data:users:1', { id: 1 }, 30);
    await cache.get('user:1');
    await cache.get('user:404');
  });

  afterAll(async () => {
    for (const k of [
      'OPS_CACHE_VALUE_PREVIEW',
      'OPS_CACHE_FLUSH_ENABLED',
      'OPS_CACHE_ACTIONS_ENABLED',
    ])
      delete process.env[k];
    await context.close();
  });

  it('overview: driver, sức khoẻ, keyspace thật', async () => {
    const { status, body } = await call<{
      driver: string;
      health: { status: string; pingMs: number | null };
      kpis: { keys: number | null };
      keyspace: { totalKeys: number; persistent: number; expiringNext60s: number } | null;
      settings: { flushEnabled: boolean };
    }>('GET', `${base}/overview?range=15m`);
    expect(status).toBe(200);
    expect(body.data.driver).toBe('redis');
    expect(body.data.health.status).toBe('healthy');
    expect(body.data.kpis.keys).toBe(4);
    expect(body.data.keyspace).toMatchObject({ totalKeys: 4, persistent: 1, expiringNext60s: 1 });
    expect(body.data.settings.flushEnabled).toBe(false);
  });

  it('namespaces + key explorer (SCAN) + chi tiết key có mask', async () => {
    const ns = await call<{ namespaces: { name: string; keys: number; session: boolean }[] }>(
      'GET',
      `${base}/namespaces`,
    );
    const names = Object.fromEntries(ns.body.data.namespaces.map((n) => [n.name, n]));
    expect(names['user']!.keys).toBe(2);
    expect(names['auth:session']!.session).toBe(true);

    const keys = await call<{
      keys: { available: boolean; data: { key: string }[] };
      done: boolean;
    }>('GET', `${base}/keys?namespace=user`);
    expect(keys.body.data.keys.data.map((k) => k.key).sort()).toEqual(['user:1', 'user:2']);
    expect(keys.body.data.done).toBe(true);

    const detail = await call<{
      type: string;
      value: { state: string; sample?: { value: unknown } };
    }>('GET', `${base}/keys/detail?key=${encodeURIComponent('user:1')}`);
    expect(detail.body.data.type).toBe('string');
    expect(detail.body.data.value.sample!.value).toEqual({
      name: 'An',
      password: '[REDACTED]',
      email: 'a***@example.com',
    });

    const session = await call<{ value: { state: string; reason: string } }>(
      'GET',
      `${base}/keys/detail?key=${encodeURIComponent('auth:session:abcdefabcdefabcdef12')}`,
    );
    expect(session.body.data.value).toEqual({ state: 'hidden', reason: 'sensitive' });
  });

  it('xoá key / clear namespace cần xác nhận đúng; flush mặc định tắt', async () => {
    expect((await call('DELETE', `${base}/keys?key=user:2`, { confirm: 'NO' })).status).toBe(400);
    const del = await call<{ action: string; affected: number }>(
      'DELETE',
      `${base}/keys?key=user:2`,
      {
        confirm: 'DELETE',
      },
    );
    expect(del.body.data).toMatchObject({ action: 'delete_key', affected: 1 });
    expect((await call('DELETE', `${base}/keys?key=user:2`, { confirm: 'DELETE' })).status).toBe(
      404,
    );

    const url = `${base}/namespaces/${encodeURIComponent('data:users')}/clear`;
    expect((await call('POST', url, { confirm: 'data' })).status).toBe(400);
    expect((await call('POST', url, { confirm: 'data:users' })).body.data).toMatchObject({
      affected: 1,
    });

    const flush = await call('POST', `${base}/flush`, { confirm: 'FLUSH CACHE' });
    expect(flush.status).toBe(409);
    expect(flush.body.error?.code).toBe('CACHE_FLUSH_DISABLED');

    const ops = await call<{ action: string }[]>('GET', `${base}/operations`);
    expect(ops.body.data.map((o) => o.action)).toEqual(['clear_namespace', 'delete_key']);
    const events = await call<{ message: string }[]>('GET', `${base}/events?range=1h`);
    expect(events.body.data[0]!.message).toContain('data:users');
  });

  it('validation, ping, cấu hình không lộ mật khẩu, chart', async () => {
    expect((await call('GET', `${base}/overview?range=2d`)).status).toBe(400);
    expect((await call('GET', `${base}/keys?cursor=abc`)).status).toBe(400);
    const ping = await call<{ ok: boolean }>('POST', `${base}/ping`);
    expect(ping.body.data.ok).toBe(true);
    const cfg = await call<{ items: { key: string; value: unknown }[] }>('GET', `${base}/config`);
    expect(cfg.body.data.items.find((i) => i.key === 'password')!.value).toBe(false);
    const metrics = await call<{ series: { id: string }[] }>(
      'GET',
      `${base}/metrics?metric=operations`,
    );
    expect(metrics.body.data.series[0]!.id).toBe('getsPerSec');
    const impact = await call<{ keys: number; sessionKeys: number }>('GET', `${base}/flush/impact`);
    expect(impact.body.data).toMatchObject({ keys: 2, sessionKeys: 1 });
  });
});
