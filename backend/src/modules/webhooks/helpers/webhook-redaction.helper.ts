import { BadRequestAppException } from '@packages/kernel/index.js';
import { WEBHOOK_DEFAULTS } from '../enum/webhooks.enum.js';

const FORBIDDEN_CUSTOM_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'content-type',
  'user-agent',
  'x-webhook-id',
  'x-webhook-event',
  'x-webhook-timestamp',
  'x-webhook-signature',
  'x-webhook-attempt',
  'x-correlation-id',
]);

const SENSITIVE_HEADER_PATTERNS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-webhook-signature',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'token',
  'secret',
];

const HEADER_NAME_REGEX = /^[a-zA-Z0-9-]+$/;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function normalizeAndValidateCustomHeaders(
  headers?: Record<string, string> | null,
): Record<string, string> {
  if (!headers) return {};
  const normalized: Record<string, string> = {};

  for (const [rawKey, rawVal] of Object.entries(headers)) {
    const key = rawKey.trim();
    const lowerKey = key.toLowerCase();
    const val = String(rawVal ?? '').trim();

    if (
      !key ||
      !HEADER_NAME_REGEX.test(key) ||
      FORBIDDEN_CUSTOM_HEADER_NAMES.has(lowerKey) ||
      lowerKey.startsWith('x-webhook-') ||
      hasControlChars(val)
    ) {
      throw new BadRequestAppException('webhooks.invalidHeaders', [
        { field: `customHeaders.${key}`, message: `Forbidden or invalid header "${key}"` },
      ]);
    }
    normalized[key] = val;
  }

  return normalized;
}

export function isSensitiveHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return SENSITIVE_HEADER_PATTERNS.some((p) => lower === p || lower.includes(p));
}

export function redactWebhookHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitiveHeaderName(k) ? '••••••••' : v;
  }
  return out;
}

export function sanitizeWebhookResponseSnippet(
  rawBody: string | null | undefined,
  maxLength: number = WEBHOOK_DEFAULTS.MAX_RESPONSE_SNIPPET_LENGTH,
): string | null {
  if (!rawBody) return null;
  const trimmed = rawBody.trim();
  if (!trimmed) return null;

  const redacted = trimmed.replace(
    /(["']?(?:authorization|secret|token|password|api[-_]?key)["']?\s*[:=]\s*["']?)([^\s"',}]+)(["']?)/gi,
    '$1••••••••$3',
  );

  if (redacted.length <= maxLength) {
    return redacted;
  }
  return `${redacted.slice(0, maxLength)}...[truncated]`;
}
