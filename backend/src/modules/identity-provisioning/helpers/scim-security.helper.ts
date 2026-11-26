import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { redactPayload } from '@packages/http/index.js';

const SCIM_TOKEN_PREFIX = 'scim_';

export interface GeneratedScimToken {
  readonly plainToken: string;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
}

/** Tạo Bearer Token ngẫu nhiên chuẩn M2M cho SCIM Client và trả về bản hash SHA-256 */
export function generateScimBearerToken(): GeneratedScimToken {
  const secret = randomBytes(32).toString('base64url');
  const plainToken = `${SCIM_TOKEN_PREFIX}${secret}`;
  const tokenHash = hashScimToken(plainToken);
  const tokenPrefix =
    plainToken.length > 14
      ? `${plainToken.slice(0, 10)}...${plainToken.slice(-4)}`
      : `${plainToken.slice(0, 8)}...`;
  return { plainToken, tokenHash, tokenPrefix };
}

export function hashScimToken(plainToken: string): string {
  return createHash('sha256').update(plainToken.trim(), 'utf8').digest('hex');
}

export function verifyScimTokenHash(plainToken: string, expectedHash: string): boolean {
  const a = hashScimToken(plainToken);
  const b = expectedHash.trim();
  if (!plainToken.trim() || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/** Chuẩn hóa IP người gọi (gỡ tiền tố `::ffff:` của IPv4-mapped IPv6) */
export function normalizeCallerIp(ip?: string | null): string | null {
  if (!ip || !ip.trim()) return null;
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

export function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number.parseInt(part, 10);
    if (octet < 0 || octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value >>> 0;
}

export function matchIpv4Cidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  if (!rangeIp || !prefixStr) return false;
  const prefix = Number.parseInt(prefixStr, 10);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;

  const ipInt = ipv4ToUint32(ip);
  const rangeInt = ipv4ToUint32(rangeIp.trim());
  if (ipInt === null || rangeInt === null) return false;

  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : ~((1 << (32 - prefix)) - 1) >>> 0;
  return (ipInt & mask) >>> 0 === (rangeInt & mask) >>> 0;
}

/** Kiểm tra IP gọi API SCIM có khớp allowlist (IP đơn, wildcard `*`, hoặc CIDR IPv4) hay không */
export function isScimClientIpAllowed(
  callerIp: string | null,
  allowedIps: readonly string[],
): boolean {
  if (allowedIps.length === 0) return true;
  const normalizedCaller = normalizeCallerIp(callerIp);
  if (!normalizedCaller) return false;

  for (const rawRule of allowedIps) {
    const rule = normalizeCallerIp(rawRule) ?? rawRule.trim();
    if (!rule) continue;
    if (rule === '*' || rule === '0.0.0.0/0') return true;
    if (rule === normalizedCaller) return true;

    if (rule.includes('*')) {
      const escapedParts: string[] = rule
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const regexPattern: string = `^${escapedParts.join('.*')}$`;
      if (new RegExp(regexPattern).test(normalizedCaller)) {
        return true;
      }
    }

    if (rule.includes('/') && matchIpv4Cidr(normalizedCaller, rule)) {
      return true;
    }
  }

  return false;
}

export function normalizeAllowedIpList(ips: readonly string[]): string[] {
  return Array.from(
    new Set(
      ips
        .map((ip) => normalizeCallerIp(ip) ?? ip.trim())
        .filter((ip): ip is string => Boolean(ip && ip.length > 0)),
    ),
  );
}

function canonicalizeForFingerprint(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForFingerprint(item));
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        sorted[key] = canonicalizeForFingerprint(entry);
      }
    }
    return sorted;
  }
  return value;
}

/** Tính dấu vân tay SHA-256 chuẩn hóa bất biến theo thứ tự key để phát hiện request SCIM trùng lặp */
export function computeScimPayloadFingerprint(payload: unknown): string {
  const canonical = canonicalizeForFingerprint(payload);
  return createHash('sha256')
    .update(JSON.stringify(canonical ?? null), 'utf8')
    .digest('hex');
}

export function formatScimEtag(version: number): string {
  const safeVersion = Number.isInteger(version) && version > 0 ? version : 1;
  return `W/"${safeVersion}"`;
}

export type ParsedIfMatch = number | '*' | 'INVALID' | null;

/** Phân tích header `If-Match` (hỗ trợ `W/"3"`, `"3"`, `3`, `*`) */
export function parseScimIfMatchVersion(rawHeader?: string | string[] | null): ParsedIfMatch {
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed === '*') return '*';

  const weakStripped = trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
  const unquoted =
    weakStripped.startsWith('"') && weakStripped.endsWith('"') && weakStripped.length >= 2
      ? weakStripped.slice(1, -1).trim()
      : weakStripped;

  if (!/^\d+$/.test(unquoted)) {
    return 'INVALID';
  }
  const parsed = Number.parseInt(unquoted, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return 'INVALID';
  }
  return parsed;
}

const EXTRA_SCIM_SENSITIVE_KEYS = new Set([
  'password',
  'authorization',
  'token',
  'plaintoken',
  'tokenhash',
  'secret',
  'clientsecret',
]);

function stripExtraScimSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripExtraScimSecrets(item, depth + 1));
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = EXTRA_SCIM_SENSITIVE_KEYS.has(key.toLowerCase())
        ? '[REDACTED]'
        : stripExtraScimSecrets(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** Che giấu thông tin nhạy cảm trước khi lưu nhật ký đồng bộ SCIM */
export function redactScimPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const redacted = redactPayload(stripExtraScimSecrets(payload) as Record<string, unknown>);
  return typeof redacted === 'object' && redacted !== null
    ? (redacted as Record<string, unknown>)
    : null;
}
