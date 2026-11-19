import { BadRequestAppException } from '@packages/kernel/index.js';

const HEADER_NAME_REGEX = /^[a-zA-Z0-9-]+$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizeAndValidateHeaderName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed || trimmed.length > 120 || !HEADER_NAME_REGEX.test(trimmed)) {
    throw new BadRequestAppException('inbound-webhooks.invalidHeaderName', [
      { field: 'headerName', message: `Invalid HTTP header name "${name}"` },
    ]);
  }
  return trimmed;
}

export function normalizeIncomingHeaders(
  headers: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(headers)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    if (Array.isArray(rawVal)) {
      const first = rawVal.find((v) => v !== undefined && v !== null);
      if (first !== undefined) {
        normalized[key] = String(first).trim();
      }
    } else if (rawVal !== undefined && rawVal !== null) {
      normalized[key] = String(rawVal).trim();
    }
  }
  return normalized;
}

export function extractNestedString(
  payload: unknown,
  dotPath: string | null | undefined,
  maxLength = 160,
): string | null {
  if (!dotPath || !payload || typeof payload !== 'object') {
    return null;
  }

  const segments = dotPath
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  let current: unknown = payload;
  for (const segment of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      return null;
    }
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) {
      return null;
    }
    current = record[segment];
  }

  if (typeof current === 'string') {
    const trimmed = current.trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
  }
  if (typeof current === 'number' && Number.isFinite(current)) {
    return String(current).slice(0, maxLength);
  }
  return null;
}

export function extractExternalEventId(
  headers: Readonly<Record<string, string>>,
  parsedPayload: unknown,
  config: {
    readonly eventIdHeader: string;
    readonly eventIdPayloadPath?: string | null | undefined;
  },
): string | null {
  const fromHeader = headers[config.eventIdHeader.trim().toLowerCase()]?.trim();
  if (fromHeader) {
    return fromHeader.slice(0, 160);
  }
  return extractNestedString(parsedPayload, config.eventIdPayloadPath, 160);
}

export function extractEventType(
  headers: Readonly<Record<string, string>>,
  parsedPayload: unknown,
  config: {
    readonly eventTypeHeader: string;
    readonly eventTypePayloadPath?: string | null | undefined;
  },
): string | null {
  const fromHeader = headers[config.eventTypeHeader.trim().toLowerCase()]?.trim();
  if (fromHeader) {
    return fromHeader.slice(0, 160);
  }
  return extractNestedString(parsedPayload, config.eventTypePayloadPath, 160);
}
