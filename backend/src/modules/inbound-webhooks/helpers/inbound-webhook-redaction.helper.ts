import { maskEmail, maskPhone } from '@packages/kernel/index.js';
import { isSensitiveKey, redactSensitiveData } from '@packages/logging/index.js';

const SENSITIVE_HEADER_PATTERNS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-webhook-signature',
  'x-hub-signature',
  'stripe-signature',
  'signature',
  'token',
  'secret',
];

const EXTRA_SENSITIVE_PAYLOAD_KEYS = new Set([
  'creditcard',
  'cardnumber',
  'cvc',
  'pin',
  'passcode',
  'signingsecret',
  'webhooksecret',
  'bearertoken',
  'clientidsecret',
]);

const EMAIL_FIELD_KEYS = new Set([
  'email',
  'useremail',
  'customeremail',
  'recipientemail',
  'contactemail',
  'billingemail',
]);

const PHONE_FIELD_KEYS = new Set([
  'phone',
  'phonenumber',
  'mobile',
  'tel',
  'telephone',
  'customerphone',
]);

const EMAIL_VALUE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_REDACTION_DEPTH = 20;

function normalizeKeyName(key: string): string {
  return key.trim().toLowerCase().replace(/[-_]/g, '');
}

export function redactInboundHeaders(
  headers: Readonly<Record<string, string>>,
  extraSensitiveHeaderNames: readonly string[] = [],
): Record<string, string> {
  const extraSet = new Set(
    extraSensitiveHeaderNames.map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  const redacted: Record<string, string> = {};

  for (const [k, v] of Object.entries(headers)) {
    const lower = k.trim().toLowerCase();
    const isSensitive =
      extraSet.has(lower) ||
      SENSITIVE_HEADER_PATTERNS.some((pattern) => lower === pattern || lower.includes(pattern));
    redacted[k] = isSensitive ? '••••••••' : v;
  }

  return redacted;
}

function applyCustomRedactionAndPii(
  input: unknown,
  options: {
    readonly customFieldNames: ReadonlySet<string>;
    readonly customPaths: ReadonlySet<string>;
    readonly maskPiiInPayload: boolean;
  },
  currentPath = '',
  depth = 0,
): unknown {
  if (depth > MAX_REDACTION_DEPTH || input === null || input === undefined) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => applyCustomRedactionAndPii(item, options, currentPath, depth + 1));
  }

  if (typeof input === 'object' && !(input instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [rawKey, val] of Object.entries(input as Record<string, unknown>)) {
      const normalizedKey = normalizeKeyName(rawKey);
      const nextPath = currentPath
        ? `${currentPath}.${rawKey.toLowerCase()}`
        : rawKey.toLowerCase();

      if (
        isSensitiveKey(rawKey) ||
        EXTRA_SENSITIVE_PAYLOAD_KEYS.has(normalizedKey) ||
        options.customFieldNames.has(normalizedKey) ||
        options.customPaths.has(nextPath)
      ) {
        out[rawKey] = '[REDACTED]';
        continue;
      }

      if (options.maskPiiInPayload && typeof val === 'string') {
        if (EMAIL_FIELD_KEYS.has(normalizedKey) || EMAIL_VALUE_REGEX.test(val.trim())) {
          out[rawKey] = maskEmail(val.trim());
          continue;
        }
        if (PHONE_FIELD_KEYS.has(normalizedKey)) {
          out[rawKey] = maskPhone(val);
          continue;
        }
      }

      out[rawKey] = applyCustomRedactionAndPii(val, options, nextPath, depth + 1);
    }
    return out;
  }

  if (
    options.maskPiiInPayload &&
    typeof input === 'string' &&
    EMAIL_VALUE_REGEX.test(input.trim())
  ) {
    return maskEmail(input.trim());
  }

  return input;
}

export interface RedactedPayloadResult {
  readonly json: string;
  readonly truncated: boolean;
}

export function redactAndSerializeInboundPayload(
  payload: unknown,
  options: {
    readonly extraSensitiveFields?: readonly string[] | undefined;
    readonly maskPiiInPayload?: boolean | undefined;
    readonly maxStoredPayloadBytes: number;
  },
): RedactedPayloadResult {
  const customFieldNames = new Set<string>();
  const customPaths = new Set<string>();

  for (const field of options.extraSensitiveFields ?? []) {
    const clean = field.trim();
    if (!clean) continue;
    if (clean.includes('.')) {
      customPaths.add(clean.toLowerCase());
    } else {
      customFieldNames.add(normalizeKeyName(clean));
    }
  }

  const baseRedacted = redactSensitiveData(payload);
  const fullyRedacted = applyCustomRedactionAndPii(baseRedacted, {
    customFieldNames,
    customPaths,
    maskPiiInPayload: Boolean(options.maskPiiInPayload),
  });

  const normalizedObj =
    fullyRedacted && typeof fullyRedacted === 'object' && !Array.isArray(fullyRedacted)
      ? fullyRedacted
      : { value: fullyRedacted ?? null };

  const serialized = JSON.stringify(normalizedObj);
  const byteLength = Buffer.byteLength(serialized, 'utf8');

  if (byteLength <= options.maxStoredPayloadBytes) {
    return { json: serialized, truncated: false };
  }

  const budget = Math.max(256, options.maxStoredPayloadBytes - 200);
  let preview = serialized.slice(0, budget);
  while (Buffer.byteLength(preview, 'utf8') > budget && preview.length > 0) {
    preview = preview.slice(0, Math.floor(preview.length * 0.9));
  }

  const summaryJson = JSON.stringify({
    _truncated: true,
    originalBytes: byteLength,
    preview,
  });

  return { json: summaryJson, truncated: true };
}
