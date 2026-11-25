import {
  ROOT_CONTEXT,
  context,
  isSpanContextValid,
  propagation,
  trace,
  type Context,
} from '@opentelemetry/api';

export interface ActiveSpanContextInfo {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
}

/** Lấy `traceId` và `spanId` từ OpenTelemetry span đang hoạt động trong context hiện tại. */
export function getActiveSpanContext(): ActiveSpanContextInfo | null {
  const span = trace.getSpan(context.active());
  if (!span) return null;
  const sc = span.spanContext();
  if (!isSpanContextValid(sc)) return null;
  return {
    traceId: sc.traceId,
    spanId: sc.spanId,
    traceFlags: sc.traceFlags,
  };
}

/** Tạo giá trị header chuẩn W3C `traceparent` (`00-<traceId>-<spanId>-<flags>`). */
export function formatTraceParent(traceId: string, spanId: string, traceFlags = 1): string {
  const flagsHex = (traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${traceId}-${spanId}-${flagsHex}`;
}

/** Chuẩn hóa carrier header về cặp `lowercase-key -> string` để W3C propagator đọc an toàn. */
export function normalizeCarrier(
  headers: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (typeof value === 'string' && value.trim()) {
      out[k] = value.trim();
    } else if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
      out[k] = value[0].trim();
    }
  }
  return out;
}

/** Ghi W3C `traceparent` / `tracestate` của active span vào carrier outbound (HTTP header / Job meta). */
export function injectTraceContext(
  carrier: Record<string, string> = {},
): Record<string, string> {
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** Khôi phục OTel Context từ carrier inbound (HTTP headers hoặc Job envelope meta). */
export function extractTraceContext(
  carrier: Record<string, unknown> | null | undefined,
): Context {
  const normalized = normalizeCarrier(carrier);
  if (Object.keys(normalized).length === 0) return ROOT_CONTEXT;
  return propagation.extract(ROOT_CONTEXT, normalized);
}
