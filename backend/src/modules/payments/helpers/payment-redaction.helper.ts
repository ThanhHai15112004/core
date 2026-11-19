import { REDACTED, redactSensitiveData, redactText } from '@packages/logging/index.js';

const EXTRA_PAYMENT_SENSITIVE_KEYS = new Set([
  'secret',
  'secretkey',
  'secret_key',
  'hashsecret',
  'hash_secret',
  'webhooksecret',
  'webhook_secret',
  'accesskey',
  'access_key',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'setcookie',
  'token',
  'password',
  'cvv',
  'cvc',
  'cardnumber',
  'card_number',
  'pan',
  'vnp_securehash',
  'signature',
  'stripesignature',
  'stripe_signature',
  'xsandboxsignature',
  'x_sandbox_signature',
]);

function normalizeSensitiveKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export function maskSecretHint(secret: string): string {
  const clean = secret.trim();
  if (!clean) return '••••';
  if (clean.length <= 6) return `${clean.slice(0, 2)}••••`;
  return `${clean.slice(0, 4)}••••${clean.slice(-2)}`;
}

export function redactPaymentObject(
  input: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> {
  if (!input || depth > 8) return {};
  const baseRedacted = redactSensitiveData(input);
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(baseRedacted)) {
    const normalized = normalizeSensitiveKey(key);
    if (EXTRA_PAYMENT_SENSITIVE_KEYS.has(normalized)) {
      out[key] = REDACTED;
    } else if (typeof val === 'string') {
      out[key] = val === REDACTED ? val : redactText(val).text;
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? redactPaymentObject(item as Record<string, unknown>, depth + 1)
          : typeof item === 'string'
            ? redactText(item).text
            : item,
      );
    } else if (val && typeof val === 'object') {
      out[key] = redactPaymentObject(val as Record<string, unknown>, depth + 1);
    } else {
      out[key] = val;
    }
  }

  return out;
}

export function redactPaymentHeaders(
  headers: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    const valStr = Array.isArray(rawVal) ? String(rawVal[0] ?? '') : String(rawVal ?? '');
    if (
      key === 'authorization' ||
      key === 'cookie' ||
      key === 'x-api-key' ||
      key.includes('secret') ||
      key.includes('token')
    ) {
      out[key] = REDACTED;
    } else {
      out[key] = redactText(valStr).text;
    }
  }
  return out;
}

export function serializeRedactedPaymentPayload(
  payload: Record<string, unknown> | null | undefined,
  maxBytes: number,
): string {
  const redacted = redactPaymentObject(payload);
  const serialized = JSON.stringify(redacted);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) {
    return serialized;
  }
  const truncatedWrapper = {
    _truncated: true,
    _originalBytes: Buffer.byteLength(serialized, 'utf8'),
    preview: serialized.slice(0, Math.max(256, maxBytes - 128)),
  };
  return JSON.stringify(truncatedWrapper);
}

export function sanitizePaymentErrorMessage(
  raw: string | null | undefined,
  maxLength = 450,
): string | null {
  if (!raw) return null;
  const clean = raw.trim();
  if (!clean) return null;
  const redacted = redactText(clean).text;
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`;
}
