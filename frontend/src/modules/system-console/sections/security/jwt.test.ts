import { describe, expect, it } from 'vitest';
import { decodeJwt } from './jwt';

const b64url = (obj: unknown) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const token = (payload: Record<string, unknown>) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

describe('decodeJwt', () => {
  it('decodes header and payload (UTF-8 safe)', () => {
    const d = decodeJwt(token({ sub: 'u1', name: 'Nguyễn' }));
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(d.payload).toEqual({ sub: 'u1', name: 'Nguyễn' });
    expect(d.isExpired).toBe(false);
  });

  it('flags expired tokens', () => {
    expect(decodeJwt(token({ exp: 1 })).isExpired).toBe(true);
    expect(decodeJwt(token({ exp: Math.floor(Date.now() / 1000) + 3600 })).isExpired).toBe(false);
  });

  it('throws "format" for wrong structure and "decode" for bad base64/json', () => {
    expect(() => decodeJwt('abc.def')).toThrow('format');
    expect(() => decodeJwt('!!!.@@@.x')).toThrow('decode');
  });
});
