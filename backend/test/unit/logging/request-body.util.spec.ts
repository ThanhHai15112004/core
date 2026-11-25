import { describe, it, expect } from '@jest/globals';
import { pickAllowedRequestBody } from '@packages/logging/utils/request-body.util.js';

describe('pickAllowedRequestBody Unit Tests', () => {
  it('returns undefined for non-objects or empty allowlists', () => {
    expect(pickAllowedRequestBody(null, ['email'])).toBeUndefined();
    expect(pickAllowedRequestBody('raw', ['email'])).toBeUndefined();
    expect(pickAllowedRequestBody(['a'], ['0'])).toBeUndefined();
    expect(pickAllowedRequestBody({ email: 'a@b.com' }, [])).toBeUndefined();
  });

  it('keeps only allowlisted fields and supports dot-notation paths', () => {
    const body = {
      email: 'user@example.com',
      password: 'secret-password',
      secretNote: 'should-be-dropped',
      filter: {
        status: 'ACTIVE',
        internalToken: 'secret-tok',
      },
    };

    const result = pickAllowedRequestBody(body, ['email', 'filter.status', 'missing']);
    expect(result).toEqual({
      email: 'user@example.com',
      filter: { status: 'ACTIVE' },
    });
  });

  it('always redacts sensitive keys even when mistakenly allowlisted', () => {
    const body = {
      username: 'alice',
      password: 'Password123!',
      nested: {
        accessToken: 'tok-xyz',
        note: 'Bearer my-raw-jwt-token',
      },
    };

    const result = pickAllowedRequestBody(body, ['username', 'password', 'nested']);
    expect(result).toEqual({
      username: 'alice',
      password: '[REDACTED]',
      nested: {
        accessToken: '[REDACTED]',
        note: 'Bearer [REDACTED]',
      },
    });
  });

  it('truncates payload when serialized size exceeds maxBytes', () => {
    const body = {
      description: 'x'.repeat(500),
    };

    const result = pickAllowedRequestBody(body, ['description'], 160);
    expect(result).toBeDefined();
    expect(result?._truncated).toBe(true);
    expect(typeof result?._bytes).toBe('number');
    expect(typeof result?.preview).toBe('string');
  });
});
