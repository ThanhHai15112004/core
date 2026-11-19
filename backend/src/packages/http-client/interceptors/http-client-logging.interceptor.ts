import { Logger } from '@nestjs/common';
import {
  REDACTED,
  isSensitiveKey,
  redactSensitiveData,
  redactText,
} from '@packages/logging/index.js';

export interface OutboundRequestLogMeta {
  readonly service: string;
  readonly method: string;
  readonly url: string;
  readonly attempt: number;
  readonly requestId?: string | null | undefined;
  readonly traceId?: string | null | undefined;
  readonly enabled?: boolean | undefined;
}

export interface OutboundResponseLogMeta extends OutboundRequestLogMeta {
  readonly status: number;
  readonly durationMs: number;
}

export interface OutboundRetryLogMeta extends OutboundRequestLogMeta {
  readonly nextDelayMs: number;
  readonly reason: string;
}

export interface OutboundErrorLogMeta {
  readonly service: string;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly code: string;
  readonly durationMs: number;
  readonly attempts: number;
  readonly message: string;
  readonly requestId?: string | null | undefined;
  readonly traceId?: string | null | undefined;
  readonly enabled?: boolean | undefined;
}

/**
 * Interceptor ghi nhận nhật ký outbound HTTP có kiểm soát:
 * che token/credentials trên URL, headers, error snippet và không log toàn bộ payload.
 */
export class HttpClientLoggingInterceptor {
  private static readonly logger = new Logger('OutboundHttpClient');

  /** Che credentials và query params nhạy cảm (token, api_key, secret...) khỏi URL trước khi log */
  public static sanitizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.username) parsed.username = REDACTED;
      if (parsed.password) parsed.password = REDACTED;
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (isSensitiveKey(key)) {
          parsed.searchParams.set(key, REDACTED);
        }
      }
      const sanitized = parsed.toString().replaceAll('%5BREDACTED%5D', REDACTED);
      return redactText(sanitized).text;
    } catch {
      return redactText(rawUrl).text;
    }
  }

  /** Che các headers nhạy cảm (Authorization, X-Api-Key, Cookie...) và chuỗi JWT/Bearer nhúng trong header */
  public static sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const keyed = redactSensitiveData(headers);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(keyed)) {
      out[k] = typeof v === 'string' && v !== REDACTED ? redactText(v).text : v;
    }
    return out;
  }

  /** Cắt gọn và che bí mật trong thông điệp hoặc đoạn phản hồi lỗi */
  public static sanitizeSnippet(text: string | null | undefined, maxLength = 256): string | null {
    if (!text) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    const redacted = redactText(trimmed).text;
    if (redacted.length <= maxLength) return redacted;
    return `${redacted.slice(0, maxLength)}…`;
  }

  /** Ghi log khi bắt đầu gửi outbound request (chỉ log metadata + trace, không log payload) */
  public static logRequest(meta: OutboundRequestLogMeta): number {
    const startTime = Date.now();
    if (meta.enabled === false) return startTime;
    const safeUrl = this.sanitizeUrl(meta.url);
    const traceTag = this.formatTraceTag(meta.requestId, meta.traceId);
    this.logger.debug(
      `--> [${meta.service}] ${meta.method.toUpperCase()} ${safeUrl} (attempt=${meta.attempt}${traceTag})`,
    );
    return startTime;
  }

  /** Ghi log khi nhận được phản hồi thành công từ dịch vụ ngoài */
  public static logResponse(meta: OutboundResponseLogMeta): void {
    if (meta.enabled === false) return;
    const safeUrl = this.sanitizeUrl(meta.url);
    const traceTag = this.formatTraceTag(meta.requestId, meta.traceId);
    this.logger.debug(
      `<-- [${meta.service}] ${meta.method.toUpperCase()} ${safeUrl} [${meta.status}] +${meta.durationMs}ms (attempt=${meta.attempt}${traceTag})`,
    );
  }

  /** Ghi log cảnh báo khi chuẩn bị thử lại lỗi tạm thời */
  public static logRetry(meta: OutboundRetryLogMeta): void {
    if (meta.enabled === false) return;
    const safeUrl = this.sanitizeUrl(meta.url);
    const safeReason = redactText(meta.reason).text;
    const traceTag = this.formatTraceTag(meta.requestId, meta.traceId);
    this.logger.warn(
      `<~> [${meta.service}] Retry ${meta.method.toUpperCase()} ${safeUrl} in ${meta.nextDelayMs}ms (attempt=${meta.attempt}, reason=${safeReason}${traceTag})`,
    );
  }

  /** Ghi log lỗi cuối cùng sau khi hết retry hoặc bị từ chối */
  public static logError(meta: OutboundErrorLogMeta): void {
    if (meta.enabled === false) return;
    const safeUrl = this.sanitizeUrl(meta.url);
    const safeMsg = redactText(meta.message).text;
    const traceTag = this.formatTraceTag(meta.requestId, meta.traceId);
    const statusLabel = meta.status !== null ? String(meta.status) : meta.code;
    this.logger.warn(
      `<-- [${meta.service}] ${meta.method.toUpperCase()} ${safeUrl} [${statusLabel}] +${meta.durationMs}ms attempts=${meta.attempts}${traceTag}: ${safeMsg}`,
    );
  }

  private static formatTraceTag(requestId?: string | null, traceId?: string | null): string {
    const parts: string[] = [];
    if (requestId) parts.push(`reqId=${requestId}`);
    if (traceId && traceId !== requestId) parts.push(`traceId=${traceId}`);
    return parts.length > 0 ? ` ${parts.join(' ')}` : '';
  }
}
