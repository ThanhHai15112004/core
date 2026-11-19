import { REDACTED, redactSensitiveData, redactText } from '@packages/logging/index.js';

const SENSITIVE_KEY_TOKENS = [
  'secret',
  'password',
  'passwd',
  'token',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
  'authorization',
  'cookie',
  'credential',
  'hmac',
];

function isSensitiveFieldName(key: string): boolean {
  const norm = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return SENSITIVE_KEY_TOKENS.some((tok) => norm.includes(tok));
}

export function maskProviderSecretHint(secret: string): string {
  const clean = secret.trim();
  if (!clean) return '••••';
  if (clean.length <= 6) return `${clean.slice(0, 2)}••••`;
  return `${clean.slice(0, 4)}••••${clean.slice(-2)}`;
}

export function redactProviderConfigObject(
  input: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> {
  if (!input || depth > 8) return {};
  const baseRedacted = redactSensitiveData(input);
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(baseRedacted)) {
    if (isSensitiveFieldName(key)) {
      out[key] = REDACTED;
    } else if (typeof val === 'string') {
      out[key] = val === REDACTED ? val : redactText(val).text;
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? redactProviderConfigObject(item as Record<string, unknown>, depth + 1)
          : typeof item === 'string'
            ? redactText(item).text
            : item,
      );
    } else if (val && typeof val === 'object') {
      out[key] = redactProviderConfigObject(val as Record<string, unknown>, depth + 1);
    } else {
      out[key] = val;
    }
  }

  return out;
}

export function sanitizeProviderErrorMessage(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const cleaned = redactText(raw.trim()).text;
  return cleaned.length > 480 ? `${cleaned.slice(0, 477)}...` : cleaned;
}

export function computeChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (key === 'updatedAt' || key === 'version' || key === 'createdAt') continue;
    const prevVal = before?.[key];
    const nextVal = after?.[key];
    if (JSON.stringify(prevVal) !== JSON.stringify(nextVal)) {
      changed.push(key);
    }
  }
  return changed.sort();
}
