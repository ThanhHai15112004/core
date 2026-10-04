import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestContextService } from '../context/request-context.service.js';
import { resolveRequestId } from '../utils/request-id.js';

/** Mở RequestContext (AsyncLocalStorage) cho mỗi HTTP request với `correlationId` = `reqId` của pino-http. */
export function requestContextMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  RequestContextService.runWith({ correlationId: resolveRequestId(req, res) }, next);
}
