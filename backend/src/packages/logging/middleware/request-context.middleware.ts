import type { IncomingMessage, ServerResponse } from 'node:http';
import { context, isSpanContextValid, trace } from '@opentelemetry/api';
import { RequestContextService } from '../context/request-context.service.js';
import { setHttpLogMeta } from '../utils/http-log-meta.js';
import { resolveHttpRequestId, resolveRequestId, resolveTraceId } from '../utils/request-id.js';

/** Mở RequestContext (AsyncLocalStorage) cho mỗi HTTP request với `correlationId`, `requestId`, `traceId`, `spanId`, `ipAddress`, `userAgent`. */
export function requestContextMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const correlationId = resolveRequestId(req, res);
  const requestId = resolveHttpRequestId(req, res, correlationId);
  const activeSc = trace.getSpan(context.active())?.spanContext();
  const hasValidSpan = Boolean(activeSc && isSpanContextValid(activeSc));
  const traceId = hasValidSpan && activeSc ? activeSc.traceId : resolveTraceId(req, res);
  const spanId = hasValidSpan && activeSc ? activeSc.spanId : undefined;
  if (hasValidSpan && !res.headersSent) {
    res.setHeader('x-trace-id', traceId);
  }
  const startedAt = Date.now();
  const forwardedFor = req.headers['x-forwarded-for'];
  const ipAddress =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]?.trim()) ||
    req.socket?.remoteAddress ||
    null;
  const rawUa = req.headers['user-agent'];
  const userAgent = (Array.isArray(rawUa) ? rawUa[0] : rawUa) ?? null;

  setHttpLogMeta(req, { startedAt, requestId, correlationId, traceId });

  RequestContextService.runWith(
    {
      correlationId,
      requestId,
      traceId,
      ...(spanId ? { spanId } : {}),
      startedAt,
      ipAddress,
      userAgent,
    },
    next,
  );
}
