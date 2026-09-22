const SENSITIVE_KEYS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'clientsecret',
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'privatekey',
  'creditcardnumber',
  'cvv',
  'otp',
  'xapikey',
  'xauthtoken',
  'proxyauthorization',
  'sessionid',
]);

/** So khớp không phân biệt hoa thường và bỏ `-`/`_`: `X-Api-Key`, `api_key`, `apiKey` đều nhạy cảm. */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_KEYS.has(normalized) || SENSITIVE_KEYS.has(key.toLowerCase());
}

export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof input === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = redactSensitiveData(value);
      } else {
        redacted[key] = value;
      }
    }
    return redacted as T;
  }

  return input;
}
