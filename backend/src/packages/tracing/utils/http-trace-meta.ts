import type { IncomingMessage } from 'node:http';
import { SpanStatusCode, isSpanContextValid, type Span } from '@opentelemetry/api';

export interface HttpTraceState {
  readonly span: Span;
  ended: boolean;
  route?: string;
}

const HTTP_TRACE_MAP = new WeakMap<IncomingMessage, HttpTraceState>();

export function setHttpTraceState(req: IncomingMessage, state: HttpTraceState): void {
  HTTP_TRACE_MAP.set(req, state);
}

export function getHttpTraceState(req: IncomingMessage): HttpTraceState | undefined {
  return HTTP_TRACE_MAP.get(req);
}

/** Đóng HTTP server span một lần duy nhất (idempotent giữa Fastify `onResponse` và `res.close`). */
export function finishHttpTraceSpan(
  req: IncomingMessage,
  statusCode: number,
  route?: string,
  method?: string,
): void {
  const state = HTTP_TRACE_MAP.get(req);
  if (!state || state.ended) return;
  state.ended = true;

  const span = state.span;
  if (route) {
    state.route = route;
    span.setAttribute('http.route', route);
    if (method) {
      span.updateName(`${method.toUpperCase()} ${route}`);
    }
  }
  if (Number.isFinite(statusCode) && statusCode > 0) {
    span.setAttribute('http.response.status_code', statusCode);
    if (statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
  }
  if (isSpanContextValid(span.spanContext())) {
    span.end();
  }
}
