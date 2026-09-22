import { describe, it, expect } from '@jest/globals';
import {
  MASK,
  buildRoute,
  captureBody,
  maskHeaders,
  maskIp,
  matchesGlob,
  moduleOf,
  redactQuery,
} from '@packages/traffic/index.js';

describe('traffic capture', () => {
  it('che header nhạy cảm, giữ scheme của Authorization', () => {
    const out = maskHeaders({
      authorization: 'Bearer abc.def',
      cookie: 'sid=1',
      'x-api-key': 'k',
      'X-Auth-Token': 't',
      accept: 'application/json',
    });
    expect(out['authorization']).toBe(`Bearer ${MASK}`);
    expect(out['cookie']).toBe(MASK);
    expect(out['x-api-key']).toBe(MASK);
    expect(out['X-Auth-Token']).toBe(MASK);
    expect(out['accept']).toBe('application/json');
    expect(JSON.stringify(out)).not.toContain('abc.def');
  });

  it('redact field nhạy cảm và che email trong body JSON', () => {
    const body = captureBody(
      { email: 'john@example.com', password: 'p', nested: { token: 't' } },
      'application/json',
      8192,
      true,
    );
    expect(body.kind).toBe('json');
    expect(body.value).toEqual({
      email: 'j***@example.com',
      password: '[REDACTED]',
      nested: { token: '[REDACTED]' },
    });
  });

  it('parse payload chuỗi JSON của response rồi redact', () => {
    const body = captureBody(
      '{"accessToken":"x","ok":true}',
      'application/json; charset=utf-8',
      8192,
      true,
    );
    expect(body.value).toEqual({ accessToken: '[REDACTED]', ok: true });
  });

  it('cắt body quá lớn và không lưu khi bị tắt / rỗng / binary', () => {
    const big = captureBody({ data: 'x'.repeat(500) }, 'application/json', 100, true);
    expect(big.truncated).toBe(true);
    expect(String(big.value).length).toBe(100);
    expect(captureBody({ a: 1 }, 'application/json', 100, false).omitted).toBe('disabled');
    expect(captureBody(undefined, undefined, 100, true).omitted).toBe('empty');
    expect(captureBody(Buffer.from('abc'), 'image/png', 100, true).omitted).toBe('binary');
  });

  it('che IP và redact query', () => {
    expect(maskIp('192.168.1.42')).toBe('192.168.1.x');
    expect(maskIp('::ffff:10.0.0.7')).toBe('10.0.0.x');
    expect(maskIp(undefined)).toBeNull();
    expect(redactQuery({ q: 'a', api_key: 'k' })).toEqual({ q: 'a', api_key: '[REDACTED]' });
  });

  it('suy ra module từ route template và đánh dấu nội bộ', () => {
    expect(moduleOf('/api/v1/users/:id', 'api/v1')).toBe('users');
    expect(moduleOf('/users', 'api/v1')).toBe('users');
    const route = buildRoute('GET', '/api/v1/ops/runtimes', 'api/v1', ['ops', 'health']);
    expect(route).toMatchObject({ module: 'ops', internal: true, method: 'GET' });
    expect(route.id).toMatch(/^[0-9a-f]{12}$/);
    expect(buildRoute('GET', '/api/v1/ops/runtimes', 'api/v1', []).id).toBe(route.id);
  });

  it('so khớp glob loại trừ route', () => {
    expect(matchesGlob('/api/v1/health', ['/api/v1/health*'])).toBe(true);
    expect(matchesGlob('/api/v1/users', ['/api/v1/health*'])).toBe(false);
  });
});
