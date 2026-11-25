import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SpanKind,
  context,
  isSpanContextValid,
  trace,
} from '@opentelemetry/api';
import { SPAN_CATEGORY_ATTR } from '../constants/tracing.constant.js';
import { finishHttpTraceSpan, setHttpTraceState } from '../utils/http-trace-meta.js';
import { extractTraceContext, formatTraceParent } from '../utils/trace-context.util.js';

export interface HttpTracingMiddlewareOptions {
  readonly enabled: boolean;
}

/**
 * Tạo middleware HTTP mở OpenTelemetry `SERVER` span ngay đầu vòng đời request,
 * trích xuất W3C `traceparent` (nếu có) và gắn `x-trace-id` / `traceparent` vào response.
 */
export function createHttpTracingMiddleware(
  getOptions: () => HttpTracingMiddlewareOptions,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    const opts = getOptions();
    if (!opts.enabled) {
      next();
      return;
    }

    const parentCtx = extractTraceContext(req.headers as Record<string, unknown>);
    const rawUrl = req.url ?? '/';
    const pathOnly = rawUrl.split('?')[0] ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();
    const tracer = trace.getTracer('core-framework');

    const span = tracer.startSpan(
      `${method} ${pathOnly}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          [SPAN_CATEGORY_ATTR]: 'api',
          'http.request.method': method,
          'url.path': pathOnly,
        },
      },
      parentCtx,
    );

    setHttpTraceState(req, { span, ended: false });

    const sc = span.spanContext();
    if (isSpanContextValid(sc) && !res.headersSent) {
      res.setHeader('x-trace-id', sc.traceId);
      res.setHeader('traceparent', formatTraceParent(sc.traceId, sc.spanId, sc.traceFlags));
    }

    // Fallback an toàn nếu connection đóng sớm trước khi Fastify `onResponse` kịp chạy
    res.once('close', () => {
      finishHttpTraceSpan(req, res.statusCode, undefined, method);
    });

    context.with(trace.setSpan(parentCtx, span), next);
  };
}
