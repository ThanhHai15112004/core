import { createHmac } from 'node:crypto';
import { PasswordHasherService } from '@packages/security/index.js';

const hasher = new PasswordHasherService();

export function hmacHex(algorithm: 'sha256' | 'sha512', secret: string, data: string): string {
  return createHmac(algorithm, secret).update(data, 'utf8').digest('hex');
}

export function verifyHmacHex(params: {
  readonly algorithm: 'sha256' | 'sha512';
  readonly secret: string;
  readonly data: string;
  readonly expectedHex: string | null | undefined;
}): boolean {
  const actual = params.expectedHex?.trim().toLowerCase();
  if (!actual || !params.secret) return false;
  const computed = hmacHex(params.algorithm, params.secret, params.data).toLowerCase();
  return hasher.safeEqualHex(computed, actual);
}

export function sha256PayloadHex(rawBody: string): string {
  return hasher.sha256(rawBody);
}

export function parseTimestampedSignatureHeader(headerValue: string | null | undefined): {
  readonly timestampSec: number | null;
  readonly signatures: readonly string[];
} {
  if (!headerValue?.trim()) {
    return { timestampSec: null, signatures: [] };
  }
  let timestampSec: number | null = null;
  const signatures: string[] = [];
  for (const part of headerValue.split(',')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!val) continue;
    if (key === 't') {
      const parsed = Number.parseInt(val, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        timestampSec = parsed;
      }
    } else if (key === 'v1') {
      signatures.push(val.toLowerCase());
    }
  }
  return { timestampSec, signatures };
}

export function isTimestampWithinTolerance(params: {
  readonly timestampSec: number | null;
  readonly toleranceSec: number;
  readonly nowSec?: number | undefined;
}): boolean {
  if (params.timestampSec === null || !Number.isFinite(params.timestampSec)) {
    return false;
  }
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  if (params.toleranceSec < 0) return true;
  return Math.abs(now - params.timestampSec) <= params.toleranceSec;
}

/** Định dạng ngày giờ `yyyyMMddHHmmss` theo múi giờ Việt Nam (UTC+7) phục vụ chữ ký VNPay. */
export function formatVnPayDateGmt7(date: Date): string {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}` +
    `${pad(shifted.getUTCMonth() + 1)}` +
    `${pad(shifted.getUTCDate())}` +
    `${pad(shifted.getUTCHours())}` +
    `${pad(shifted.getUTCMinutes())}` +
    `${pad(shifted.getUTCSeconds())}`
  );
}

/** Chuẩn hóa chuỗi tham số VNPay (sắp xếp theo key ASCII tăng dần, `%20` đổi thành `+`). */
export function buildVnPayCanonicalQuery(params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort();
  return keys
    .map((key) => {
      const encodedKey = encodeURIComponent(key);
      const encodedVal = encodeURIComponent(params[key] ?? '').replace(/%20/g, '+');
      return `${encodedKey}=${encodedVal}`;
    })
    .join('&');
}
