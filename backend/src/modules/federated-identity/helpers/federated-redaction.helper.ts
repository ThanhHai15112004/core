import { REDACTED, redactSensitiveData, redactText } from '@packages/logging/index.js';

const EXTRA_OAUTH_SENSITIVE_KEYS = new Set([
  'code',
  'codeverifier',
  'code_verifier',
  'idtoken',
  'id_token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'clientsecret',
  'client_secret',
  'stepuptoken',
  'step_up_token',
  'nonce',
  'authorization',
]);

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export function sanitizeFederatedErrorMessage(
  raw: string | null | undefined,
  maxLength = 500,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const redacted = redactText(trimmed).text;
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`;
}

export function redactFederatedMetadata(
  input: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> {
  if (!input || depth > 8) return {};
  const baseRedacted = redactSensitiveData(input);
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(baseRedacted)) {
    const normalized = normalizeKey(key);
    if (EXTRA_OAUTH_SENSITIVE_KEYS.has(normalized)) {
      out[key] = REDACTED;
    } else if (typeof val === 'string') {
      out[key] = val === REDACTED ? val : redactText(val).text;
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? redactFederatedMetadata(item as Record<string, unknown>, depth + 1)
          : typeof item === 'string'
            ? redactText(item).text
            : item,
      );
    } else if (val && typeof val === 'object') {
      out[key] = redactFederatedMetadata(val as Record<string, unknown>, depth + 1);
    } else {
      out[key] = val;
    }
  }

  return out;
}
