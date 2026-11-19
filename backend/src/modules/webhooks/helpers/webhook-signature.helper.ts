import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_DEFAULTS } from '../enum/webhooks.enum.js';

const SECRET_PREFIX = 'whsec_';

/** Sinh secret ký Webhook ngẫu nhiên 256-bit (32 bytes) */
export function generateWebhookSigningSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('hex')}`;
}

/** Tạo chuỗi rút gọn hiển thị an toàn trên UI / Audit Log (không lộ khóa bí mật) */
export function maskWebhookSigningSecret(secret: string): string {
  const clean = secret.trim();
  if (!clean) return `${SECRET_PREFIX}••••`;
  const visiblePrefix = clean.startsWith(SECRET_PREFIX)
    ? clean.slice(0, SECRET_PREFIX.length + 4)
    : clean.slice(0, 6);
  return `${visiblePrefix}••••••••`;
}

export interface WebhookSignatureResult {
  readonly timestamp: number;
  readonly signature: string;
}

/**
 * Ký payload webhook theo chuẩn HMAC-SHA256 kèm timestamp chống Replay Attack:
 * `v1=<hmac_sha256_hex("${timestamp}.${rawBody}", secret)>`
 */
export function signWebhookPayload(
  rawBody: string,
  secret: string,
  timestampSec: number = Math.floor(Date.now() / 1000),
): WebhookSignatureResult {
  const timestamp = Math.trunc(timestampSec);
  const signedContent = `${timestamp}.${rawBody}`;
  const digest = createHmac('sha256', secret).update(signedContent, 'utf8').digest('hex');
  return {
    timestamp,
    signature: `${WEBHOOK_DEFAULTS.SIGNATURE_VERSION}=${digest}`,
  };
}

/**
 * Hàm xác minh chữ ký webhook chuẩn (timing-safe + kiểm tra dung sai timestamp).
 * Hữu ích cho cả test nội bộ và SDK/tài liệu bên nhận tích hợp.
 */
export function verifyWebhookSignature(params: {
  readonly rawBody: string;
  readonly signatureHeader: string | null | undefined;
  readonly timestampHeader: string | number | null | undefined;
  readonly secret: string;
  readonly toleranceSec?: number | undefined;
  readonly nowSec?: number | undefined;
}): boolean {
  const { rawBody, signatureHeader, timestampHeader, secret } = params;
  if (!signatureHeader || timestampHeader === null || timestampHeader === undefined || !secret) {
    return false;
  }

  const parsedTs =
    typeof timestampHeader === 'number'
      ? Math.trunc(timestampHeader)
      : Number.parseInt(String(timestampHeader).trim(), 10);
  if (!Number.isFinite(parsedTs) || parsedTs <= 0) {
    return false;
  }

  const tolerance = params.toleranceSec ?? WEBHOOK_DEFAULTS.SIGNATURE_TOLERANCE_SEC;
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  if (tolerance >= 0 && Math.abs(now - parsedTs) > tolerance) {
    return false;
  }

  const expected = signWebhookPayload(rawBody, secret, parsedTs).signature;
  const actual = signatureHeader.trim();
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}
