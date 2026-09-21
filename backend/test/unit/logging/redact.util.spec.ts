import { describe, it, expect } from '@jest/globals';
import { redactSensitiveData } from '@packages/logging/redaction/redact.util.js';

describe('redactSensitiveData Unit Tests', () => {
  it('should mask sensitive keys with [REDACTED]', () => {
    const input = {
      username: 'thanhhai',
      password: 'superSecretPassword',
      token: 'jwt.token.here',
      nested: {
        authorization: 'Bearer token',
        creditCardNumber: '1234-5678-9012-3456',
        safeField: 'visible',
      },
    };

    const result = redactSensitiveData(input);

    expect(result.username).toBe('thanhhai');
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.nested.authorization).toBe('[REDACTED]');
    expect(result.nested.creditCardNumber).toBe('[REDACTED]');
    expect(result.nested.safeField).toBe('visible');
  });

  it('should handle primitives and null values gracefully', () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData(undefined)).toBeUndefined();
    expect(redactSensitiveData('hello')).toBe('hello');
    expect(redactSensitiveData(123)).toBe(123);
  });
});
