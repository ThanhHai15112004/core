import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface SecretItem {
  key: string;
  driver: string;
  present: boolean;
  length?: number;
}

interface ConfigItem {
  domain: string;
  key: string;
  value: unknown;
  source: 'env' | 'default';
  sensitive: boolean;
}

/** Giá trị secret có trong môi trường test (.env.test) — không được xuất hiện trong bất kỳ response nào. */
const SECRET_VALUES = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'DB_PASSWORD']
  .map((k) => process.env[k])
  .filter((v): v is string => Boolean(v));

/** Governance (/ops/secrets, /ops/configuration): chỉ đọc, không bao giờ lộ giá trị secret. */
describe('Governance (/ops/secrets, /ops/configuration)', () => {
  let context: TestAppContext;

  const get = async <T>(url: string) => {
    const res = await context.app.inject({ method: 'GET', url });
    return { status: res.statusCode, raw: res.body, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  it('secrets: metadata theo driver cấu hình, không có giá trị', async () => {
    expect(SECRET_VALUES.length).toBeGreaterThan(0);
    const { status, raw, body } = await get<SecretItem[]>('/ops/secrets');
    expect(status).toBe(200);
    const jwt = body.data.find((s) => s.key === 'JWT_ACCESS_SECRET');
    expect(jwt).toEqual({
      key: 'JWT_ACCESS_SECRET',
      driver: 'env',
      present: true,
      length: process.env['JWT_ACCESS_SECRET']!.length,
    });
    for (const s of body.data) {
      expect(Object.keys(s).sort()).toEqual(
        s.present ? ['driver', 'key', 'length', 'present'] : ['driver', 'key', 'present'],
      );
    }
    for (const v of SECRET_VALUES) expect(raw).not.toContain(v);
  });

  it('configuration: key nhạy cảm bị che, có nguồn env/default', async () => {
    const { status, raw, body } = await get<ConfigItem[]>('/ops/configuration');
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    const sensitive = body.data.filter((i) => i.sensitive);
    expect(sensitive.length).toBeGreaterThan(0);
    // Có giá trị → '••••••••'; trống → giữ nguyên rỗng/null (không lộ gì).
    for (const i of sensitive) expect(['••••••••', '', null, undefined]).toContain(i.value);
    for (const i of body.data) expect(['env', 'default']).toContain(i.source);
    for (const v of SECRET_VALUES) expect(raw).not.toContain(v);
  });

  it('configuration/:domain: chỉ domain đó; domain không tồn tại → rỗng', async () => {
    const db = await get<ConfigItem[]>('/ops/configuration/database');
    expect(db.status).toBe(200);
    expect(db.body.data.length).toBeGreaterThan(0);
    expect(new Set(db.body.data.map((i) => i.domain))).toEqual(new Set(['database']));
    const none = await get<ConfigItem[]>('/ops/configuration/nope');
    expect(none.body.data).toEqual([]);
  });
});
