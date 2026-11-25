import {
  SpanKind,
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import {
  SPAN_CATEGORY_ATTR,
  TRACING_INSTRUMENTATION_NAME,
  type SpanCategory,
} from '../constants/tracing.constant.js';

const SENSITIVE_ATTR_KEY_RE =
  /(password|secret|token|authorization|cookie|apikey|api_key|otp|cvv|creditcard|privatekey|param)/i;
const MAX_ATTR_STRING_LEN = 512;

export type SpanAttributeInput = Record<string, string | number | boolean | undefined>;

export interface RunInSpanOptions {
  readonly kind?: SpanKind;
  readonly category?: SpanCategory;
  readonly attributes?: SpanAttributeInput;
  readonly parentContext?: Context;
}

/** Loại bỏ attribute chứa từ khóa nhạy cảm / SQL params và cắt ngắn chuỗi quá dài. */
export function sanitizeSpanAttributes(
  input: SpanAttributeInput | undefined,
  category?: SpanCategory,
): Attributes {
  const out: Attributes = {};
  if (category) {
    out[SPAN_CATEGORY_ATTR] = category;
  }
  if (!input) return out;

  for (const [key, rawValue] of Object.entries(input)) {
    if (rawValue === undefined || SENSITIVE_ATTR_KEY_RE.test(key)) continue;
    if (typeof rawValue === 'string') {
      out[key] =
        rawValue.length > MAX_ATTR_STRING_LEN
          ? `${rawValue.slice(0, MAX_ATTR_STRING_LEN)}…`
          : rawValue;
    } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      out[key] = rawValue;
    } else if (typeof rawValue === 'boolean') {
      out[key] = rawValue;
    }
  }
  return out;
}

function isPromiseLike<T>(val: unknown): val is PromiseLike<T> {
  return (
    val !== null &&
    (typeof val === 'object' || typeof val === 'function') &&
    typeof (val as { then?: unknown }).then === 'function'
  );
}

/** Ghi nhận lỗi lên span với thông điệp an toàn và đặt status ERROR. */
export function recordSpanError(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return;
  }
  const msg = typeof error === 'string' ? error : 'Operation failed';
  span.recordException(new Error(msg));
  span.setStatus({ code: SpanStatusCode.ERROR, message: msg });
}

/**
 * Thực thi hàm sync hoặc async bên trong một OpenTelemetry span,
 * tự động lan truyền active context, đánh dấu OK/ERROR và đóng span ở `finally`.
 */
export function runInSpan<T>(name: string, options: RunInSpanOptions, fn: (span: Span) => T): T {
  const tracer = trace.getTracer(TRACING_INSTRUMENTATION_NAME);
  const baseCtx = options.parentContext ?? context.active();
  const attributes = sanitizeSpanAttributes(options.attributes, options.category ?? 'internal');

  return tracer.startActiveSpan(
    name,
    {
      ...(options.kind !== undefined ? { kind: options.kind } : {}),
      attributes,
    },
    baseCtx,
    (span) => {
      try {
        const result = fn(span);
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            (resolved) => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return resolved;
            },
            (err: unknown) => {
              recordSpanError(span, err);
              span.end();
              throw err;
            },
          ) as unknown as T;
        }
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (err) {
        recordSpanError(span, err);
        span.end();
        throw err;
      }
    },
  );
}
