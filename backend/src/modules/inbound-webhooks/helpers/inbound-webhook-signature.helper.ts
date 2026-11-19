import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  INBOUND_WEBHOOK_AUTH_TYPE,
  INBOUND_WEBHOOK_DEFAULTS,
  INBOUND_WEBHOOK_REJECTION_REASON,
  INBOUND_WEBHOOK_SIGNATURE_FORMAT,
  type InboundWebhookAuthType,
  type InboundWebhookRejectionReason,
  type InboundWebhookSignatureFormat,
} from '../enum/inbound-webhooks.enum.js';

export function generateInboundWebhookSecret(): string {
  return `${INBOUND_WEBHOOK_DEFAULTS.SECRET_PREFIX}${randomBytes(32).toString('hex')}`;
}

export function maskInboundWebhookSecret(secret: string): string {
  const clean = secret.trim();
  if (!clean) return `${INBOUND_WEBHOOK_DEFAULTS.SECRET_PREFIX}••••`;
  const visiblePrefix = clean.startsWith(INBOUND_WEBHOOK_DEFAULTS.SECRET_PREFIX)
    ? clean.slice(0, INBOUND_WEBHOOK_DEFAULTS.SECRET_PREFIX.length + 4)
    : clean.slice(0, Math.min(6, clean.length));
  return `${visiblePrefix}••••••••`;
}

export function computePayloadSha256Hex(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Chuẩn hóa giá trị timestamp từ header (Unix seconds, Unix milliseconds >= 1e12 hoặc chuỗi ISO-8601)
 * về số nguyên Unix epoch (giây). Trả `null` nếu không hợp lệ.
 */
export function parseInboundWebhookTimestamp(rawValue: unknown): number | null {
  if (rawValue === null || rawValue === undefined || typeof rawValue === 'boolean') {
    return null;
  }

  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
    return rawValue >= 1e12 ? Math.trunc(rawValue / 1000) : Math.trunc(rawValue);
  }

  const trimmed = String(rawValue).trim();
  if (!trimmed) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const parsedNum = Number(trimmed);
    if (!Number.isFinite(parsedNum) || parsedNum <= 0) return null;
    return parsedNum >= 1e12 ? Math.trunc(parsedNum / 1000) : Math.trunc(parsedNum);
  }

  const parsedDateMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedDateMs) || parsedDateMs <= 0) {
    return null;
  }
  return Math.trunc(parsedDateMs / 1000);
}

export interface TimestampValidationResult {
  readonly valid: boolean;
  readonly timestampSec: number | null;
  readonly reason: InboundWebhookRejectionReason | null;
}

export function validateInboundWebhookTimestamp(params: {
  readonly rawTimestamp: unknown;
  readonly toleranceSec: number;
  readonly nowSec?: number | undefined;
  readonly required: boolean;
}): TimestampValidationResult {
  const hasRaw =
    params.rawTimestamp !== null &&
    params.rawTimestamp !== undefined &&
    String(params.rawTimestamp).trim().length > 0;

  if (!hasRaw) {
    if (params.required) {
      return {
        valid: false,
        timestampSec: null,
        reason: INBOUND_WEBHOOK_REJECTION_REASON.MISSING_TIMESTAMP,
      };
    }
    return { valid: true, timestampSec: null, reason: null };
  }

  const parsedTs = parseInboundWebhookTimestamp(params.rawTimestamp);
  if (parsedTs === null) {
    return {
      valid: false,
      timestampSec: null,
      reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TIMESTAMP,
    };
  }

  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  if (params.toleranceSec >= 0 && Math.abs(now - parsedTs) > params.toleranceSec) {
    return {
      valid: false,
      timestampSec: parsedTs,
      reason: INBOUND_WEBHOOK_REJECTION_REASON.TIMESTAMP_EXPIRED,
    };
  }

  return { valid: true, timestampSec: parsedTs, reason: null };
}

export interface ParsedSignatureComponents {
  readonly timestampRaw: string | null;
  readonly signatures: readonly string[];
}

/**
 * Hỗ trợ cả header chữ ký tiêu chuẩn (`v1=<hex>`, `sha256=<hex>`, `<hex>`)
 * lẫn định dạng gộp kiểu Stripe (`t=1700000000,v1=<hex>`).
 */
export function parseSignatureHeaderComponents(
  signatureHeaderValue: string | null | undefined,
): ParsedSignatureComponents {
  if (!signatureHeaderValue) {
    return { timestampRaw: null, signatures: [] };
  }

  const trimmed = signatureHeaderValue.trim();
  if (!trimmed) {
    return { timestampRaw: null, signatures: [] };
  }

  if (trimmed.includes(',') && /\bt=\d+/.test(trimmed)) {
    let timestampRaw: string | null = null;
    const v1Signatures: string[] = [];
    for (const part of trimmed.split(',')) {
      const seg = part.trim();
      const eqIdx = seg.indexOf('=');
      if (eqIdx <= 0) continue;
      const k = seg.slice(0, eqIdx).trim();
      const v = seg.slice(eqIdx + 1).trim();
      if (k === 't' && v) {
        timestampRaw = v;
      } else if (k === 'v1' && v) {
        v1Signatures.push(`v1=${v}`);
        v1Signatures.push(v);
      }
    }
    if (v1Signatures.length > 0) {
      return { timestampRaw, signatures: v1Signatures };
    }
  }

  return { timestampRaw: null, signatures: [trimmed] };
}

export function computeInboundHmacSignature(params: {
  readonly rawBody: string;
  readonly secret: string;
  readonly algorithm: Extract<InboundWebhookAuthType, 'HMAC_SHA256' | 'HMAC_SHA512'>;
  readonly format: InboundWebhookSignatureFormat;
  readonly timestampSec?: number | null | undefined;
  readonly prefix?: string | null | undefined;
}): string {
  const hashAlgo = params.algorithm === INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA512 ? 'sha512' : 'sha256';
  const signedContent =
    params.format === INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY
      ? `${params.timestampSec ?? ''}.${params.rawBody}`
      : params.rawBody;
  const digest = createHmac(hashAlgo, params.secret).update(signedContent, 'utf8').digest('hex');
  const prefix = params.prefix ?? '';
  return `${prefix}${digest}`;
}

export interface VerifyInboundAuthResult {
  readonly valid: boolean;
  readonly reason: InboundWebhookRejectionReason | null;
}

export function verifyInboundWebhookAuth(params: {
  readonly authType: InboundWebhookAuthType;
  readonly rawBody: string;
  readonly secret: string;
  readonly signatureHeaderName: string;
  readonly signatureHeaderValue: string | null | undefined;
  readonly signaturePrefix?: string | null | undefined;
  readonly signatureFormat: InboundWebhookSignatureFormat;
  readonly timestampSec?: number | null | undefined;
}): VerifyInboundAuthResult {
  const headerVal = params.signatureHeaderValue?.trim() ?? '';
  if (!headerVal || !params.secret) {
    return {
      valid: false,
      reason:
        params.authType === INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN
          ? INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TOKEN
          : INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE,
    };
  }

  if (params.authType === INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN) {
    const prefix = params.signaturePrefix?.trim() ?? '';
    const expectedFull = prefix ? `${prefix} ${params.secret}`.replace(/\s+/g, ' ') : params.secret;
    if (prefix) {
      const altExpected = `${params.signaturePrefix}${params.secret}`;
      const matchesExact =
        timingSafeEqualStrings(headerVal, altExpected) ||
        timingSafeEqualStrings(headerVal, expectedFull);
      return matchesExact
        ? { valid: true, reason: null }
        : { valid: false, reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TOKEN };
    }

    const isAuthHeader = params.signatureHeaderName.trim().toLowerCase() === 'authorization';
    let actualToken = headerVal;
    if (isAuthHeader && /^bearer\s+/i.test(headerVal)) {
      actualToken = headerVal.slice(headerVal.search(/\s+/) + 1).trim();
    }

    return timingSafeEqualStrings(actualToken, params.secret)
      ? { valid: true, reason: null }
      : { valid: false, reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TOKEN };
  }

  if (
    params.signatureFormat === INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY &&
    (params.timestampSec === null || params.timestampSec === undefined)
  ) {
    return {
      valid: false,
      reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE,
    };
  }

  const prefix = params.signaturePrefix ?? '';
  const expectedWithPrefix = computeInboundHmacSignature({
    rawBody: params.rawBody,
    secret: params.secret,
    algorithm: params.authType,
    format: params.signatureFormat,
    timestampSec: params.timestampSec,
    prefix,
  });
  const expectedDigestOnly = prefix ? expectedWithPrefix.slice(prefix.length) : expectedWithPrefix;

  const { signatures } = parseSignatureHeaderComponents(headerVal);
  for (const candidate of signatures) {
    if (prefix) {
      if (candidate.startsWith(prefix)) {
        const candidateDigest = candidate.slice(prefix.length).toLowerCase();
        if (timingSafeEqualStrings(candidateDigest, expectedDigestOnly)) {
          return { valid: true, reason: null };
        }
      }
    } else if (timingSafeEqualStrings(candidate.toLowerCase(), expectedDigestOnly)) {
      return { valid: true, reason: null };
    }
  }

  return {
    valid: false,
    reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE,
  };
}
