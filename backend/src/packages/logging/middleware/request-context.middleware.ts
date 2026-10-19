import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestContextService } from '../context/request-context.service.js';
import { resolveRequestId } from '../utils/request-id.js';

/** Mở RequestContext (AsyncLocalStorage) cho mỗi HTTP request với `correlationId`, `requestId`, `ipAddress`, `userAgent`. */
export function requestContextMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const correlationId = resolveRequestId(req, res);
  const rawReqId = req.headers['x-request-id'];
  const requestId = (Array.isArray(rawReqId) ? rawReqId[0] : rawReqId) || correlationId;
  const forwardedFor = req.headers['x-forwarded-for'];
  const ipAddress =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]?.trim()) ||
    req.socket?.remoteAddress ||
    null;
  const rawUa = req.headers['user-agent'];
  const userAgent = (Array.isArray(rawUa) ? rawUa[0] : rawUa) ?? null;

  RequestContextService.runWith(
    {
      correlationId,
      requestId,
      ipAddress,
      userAgent,
    },
    next,
  );
}
