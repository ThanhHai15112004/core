import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * ID request dùng chung cho pino-http (`reqId`) và RequestContext (`correlationId`): header `x-correlation-id` hoặc
 * UUID mới. Bên nào chạy trước gán `req.id`, bên sau dùng lại — không phụ thuộc thứ tự middleware.
 */
export function resolveRequestId(req: RequestWithId, res: ServerResponse): string {
  if (typeof req.id === 'string' && req.id) return req.id;
  const header = req.headers['x-correlation-id'];
  const id = (Array.isArray(header) ? header[0] : header) || randomUUID();
  req.id = id;
  if (!res.headersSent) res.setHeader('x-correlation-id', id);
  return id;
}
