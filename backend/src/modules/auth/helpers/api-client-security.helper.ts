import {
  ForbiddenAppException,
  safeJsonParse,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import type { ApiClientUsageLogItem } from '../entities/auth-api-client.entity.js';

/** Chuẩn hóa địa chỉ IP người gọi (gỡ tiền tố IPv6-mapped IPv4 `::ffff:`) */
export function normalizeCallerIp(ip?: string | null): string | null {
  if (!ip || !ip.trim()) return null;
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

/** Chuyển đổi địa chỉ IPv4 sang số nguyên 32-bit không dấu */
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

/** Kiểm tra địa chỉ IPv4 có nằm trong dải CIDR (`x.x.x.x/prefix`) hay không */
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

/** Kiểm tra IP người gọi có khớp với danh sách `allowedIps` (hỗ trợ exact IP, wildcard `*` và CIDR `/8..32`) */
export function isCallerIpAllowed(callerIp: string | null, allowedIps: readonly string[]): boolean {
  if (allowedIps.length === 0) return true;
  if (!callerIp) return false;

  const normalizedCaller = normalizeCallerIp(callerIp);
  if (!normalizedCaller) return false;

  for (const rawRule of allowedIps) {
    const rule = normalizeCallerIp(rawRule) ?? rawRule.trim();
    if (!rule) continue;
    if (rule === '*' || rule === '0.0.0.0/0') return true;
    if (rule === normalizedCaller) return true;

    // Hỗ trợ wildcard dạng '10.10.1.*'
    if (rule.includes('*')) {
      const regexPattern: string =
        '^' +
        rule
          .split('*')
          .map((part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        '$';
      if (new RegExp(regexPattern).test(normalizedCaller)) {
        return true;
      }
    }

    // Hỗ trợ IPv4 CIDR dạng '10.10.1.0/24'
    if (rule.includes('/')) {
      if (matchIpv4Cidr(normalizedCaller, rule)) {
        return true;
      }
    }
  }

  return false;
}

/** Chuẩn hóa danh sách phạm vi quyền (scopes) không trùng lặp */
export function normalizeScopesList(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((s) => s.trim()).filter(Boolean))];
}

/** Chuẩn hóa danh sách IP/CIDR cho phép không trùng lặp */
export function normalizeAllowedIpList(ips: readonly string[]): string[] {
  return [
    ...new Set(
      ips
        .map((ip) => normalizeCallerIp(ip) ?? ip.trim())
        .filter((ip): ip is string => Boolean(ip && ip.length > 0)),
    ),
  ];
}

/** Giải mã danh sách chuỗi JSON an toàn */
export function parseJsonStringArray(jsonStr?: string | null): string[] {
  return safeJsonParseStringArray(jsonStr);
}

/** Giải mã nhật ký sử dụng API Client từ chuỗi JSON */
export function parseApiClientUsageLogs(jsonStr?: string | null): ApiClientUsageLogItem[] {
  const parsed = safeJsonParse<unknown>(jsonStr, null);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is ApiClientUsageLogItem =>
    Boolean(item && typeof item === 'object' && 'timestamp' in item && 'result' in item),
  );
}

/** Đảm bảo phạm vi quyền yêu cầu của API Client nằm trong phạm vi của Service Account sở hữu */
export function ensureScopesWithinAllowed(
  requestedScopes: readonly string[],
  allowedSaScopes: readonly string[],
): void {
  if (allowedSaScopes.length === 0 || allowedSaScopes.includes('*')) {
    return;
  }
  const exceeded = requestedScopes.filter((s) => !allowedSaScopes.includes(s));
  if (exceeded.length > 0) {
    throw new ForbiddenAppException('auth.apiClientScopeExceeded', [
      { requestedScopes, exceededScopes: exceeded, serviceAccountScopes: allowedSaScopes },
    ]);
  }
}
