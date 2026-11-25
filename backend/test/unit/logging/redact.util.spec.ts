import { describe, it, expect, afterEach } from '@jest/globals';
import {
  configureExtraSensitiveKeys,
  getSensitiveKeyNames,
  isSensitiveKey,
  redactSensitiveData,
} from '@packages/logging/redaction/redact.util.js';
import { redactText } from '@packages/logging/utils/log-redaction.js';

describe('redactSensitiveData Unit Tests', () => {
  afterEach(() => {
    configureExtraSensitiveKeys([]);
  });

  it('should mask sensitive keys deeply (>3 levels) with [REDACTED]', () => {
    const input = {
      username: 'thanhhai',
      password: 'superSecretPassword',
      token: 'jwt.token.here',
      nested: {
        authorization: 'Bearer token',
        creditCardNumber: '1234-5678-9012-3456',
        safeField: 'visible',
        level3: {
          level4: {
            client_secret: 'very-secret-4',
            apiKey: 'key-4',
            ok: true,
          },
        },
      },
    };

    const result = redactSensitiveData(input);

    expect(result.username).toBe('thanhhai');
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.nested.authorization).toBe('[REDACTED]');
    expect(result.nested.creditCardNumber).toBe('[REDACTED]');
    expect(result.nested.safeField).toBe('visible');
    expect(result.nested.level3.level4.client_secret).toBe('[REDACTED]');
    expect(result.nested.level3.level4.apiKey).toBe('[REDACTED]');
    expect(result.nested.level3.level4.ok).toBe(true);
  });

  it('should guard against circular references and max depth', () => {
    const circular: Record<string, unknown> = { safe: 'ok' };
    circular.self = circular;

    const result = redactSensitiveData(circular);
    expect(result.safe).toBe('ok');
    expect(result.self).toBe('[Circular]');

    const deep = { a: { b: { c: { d: 'too-deep' } } } };
    const capped = redactSensitiveData(deep, { maxDepth: 2 });
    expect((capped as { a: { b: { c: unknown } } }).a.b.c).toBe('[MaxDepth]');
  });

  it('should support extra sensitive keys configured via env and string pattern redaction', () => {
    configureExtraSensitiveKeys(['custom_pin', 'Citizen-Id']);
    expect(isSensitiveKey('customPin')).toBe(true);
    expect(isSensitiveKey('citizen_id')).toBe(true);
    expect(getSensitiveKeyNames()).toContain('custompin');

    const redacted = redactSensitiveData(
      {
        customPin: '123456',
        note: 'Authorization Bearer abc.def.ghi',
      },
      { redactStrings: (s) => redactText(s).text },
    );
    expect(redacted.customPin).toBe('[REDACTED]');
    expect(redacted.note).toBe('Authorization Bearer [REDACTED]');
  });

  it('should handle primitives and null values gracefully', () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData(undefined)).toBeUndefined();
    expect(redactSensitiveData('hello')).toBe('hello');
    expect(redactSensitiveData(123)).toBe(123);
  });
});
