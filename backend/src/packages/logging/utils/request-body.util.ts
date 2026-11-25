import { isSensitiveKey, redactSensitiveData } from '../redaction/redact.util.js';
import { redactText } from './log-redaction.js';

const REDACTED_VALUE = '[REDACTED]';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPathValue(
  source: Record<string, unknown>,
  segments: readonly string[],
): { found: boolean; value: unknown; hasSensitiveSegment: boolean } {
  let current: unknown = source;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (isSensitiveKey(seg)) {
      return { found: true, value: REDACTED_VALUE, hasSensitiveSegment: true };
    }
    if (!isPlainRecord(current) || !(seg in current)) {
      return { found: false, value: undefined, hasSensitiveSegment: false };
    }
    current = current[seg];
  }
  return { found: true, value: current, hasSensitiveSegment: false };
}

function setPathValue(
  target: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): void {
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (!isPlainRecord(cursor[seg])) {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, unknown>;
  }
  const leaf = segments[segments.length - 1]!;
  cursor[leaf] = value;
}

/**
 * Trích xuất phần request body chỉ gồm các field nằm trong `allowlist` (hỗ trợ cả key phẳng lẫn dot-notation),
 * che dữ liệu nhạy cảm đệ quy và giới hạn kích thước JSON theo `maxBytes`.
 */
export function pickAllowedRequestBody(
  body: unknown,
  allowlist: readonly string[],
  maxBytes = 2048,
): Record<string, unknown> | undefined {
  if (!isPlainRecord(body) || allowlist.length === 0) {
    return undefined;
  }

  const picked: Record<string, unknown> = {};
  let hasAny = false;

  for (const rawPath of allowlist) {
    const path = rawPath.trim();
    if (!path) continue;
    const segments = path.split('.').filter(Boolean);
    if (segments.length === 0) continue;

    const match = getPathValue(body, segments);
    if (!match.found) continue;
    setPathValue(picked, segments, match.value);
    hasAny = true;
  }

  if (!hasAny) {
    return undefined;
  }

  const sanitized = redactSensitiveData(picked, {
    maxDepth: 6,
    redactStrings: (s) => redactText(s).text,
  });

  const safeLimit = Math.max(128, maxBytes);
  const serialized = JSON.stringify(sanitized);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength <= safeLimit) {
    return sanitized;
  }

  const previewLength = Math.max(48, safeLimit - 80);
  return {
    _truncated: true,
    _bytes: byteLength,
    preview: serialized.slice(0, previewLength),
  };
}
