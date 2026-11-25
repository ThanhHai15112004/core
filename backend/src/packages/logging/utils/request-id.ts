import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestWithId = IncomingMessage & { id?: unknown };

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ALL_ZERO_TRACE = /^0{32}$/;

/** Lấy giá trị header đơn từ request HTTP. */
function readHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  const val = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof val === 'string' ? val.trim() : '';
  return trimmed || undefined;
}

/**
 * Tách `traceId` (32 ký tự hex) từ header chuẩn W3C `traceparent` (`00-<traceId>-<spanId>-<flags>`).
 * Trả về `null` nếu header sai định dạng hoặc traceId toàn số 0.
 */
export function parseTraceParent(header: string | undefined): string | null {
  if (!header) return null;
  const match = TRACEPARENT_RE.exec(header.trim());
  if (!match) return null;
  const [, version, traceId] = match;
  if (!version || version.toLowerCase() === 'ff' || !traceId || ALL_ZERO_TRACE.test(traceId)) {
    return null;
  }
  return traceId.toLowerCase();
}

/**
 * ID request dùng chung cho pino-http (`reqId`) và RequestContext (`correlationId`): header `x-correlation-id` hoặc
 * UUID mới. Bên nào chạy trước gán `req.id`, bên sau dùng lại — không phụ thuộc thứ tự middleware.
 */
export function resolveRequestId(req: RequestWithId, res: ServerResponse): string {
  if (typeof req.id === 'string' && req.id) return req.id;
  const id = readHeader(req, 'x-correlation-id') ?? randomUUID();
  req.id = id;
  if (!res.headersSent) res.setHeader('x-correlation-id', id);
  return id;
}

/** Xác định `requestId` của request HTTP (`x-request-id` hoặc fallback sang `correlationId`). */
export function resolveHttpRequestId(
  req: IncomingMessage,
  res: ServerResponse,
  fallback: string,
): string {
  const id = readHeader(req, 'x-request-id') ?? fallback;
  if (!res.headersSent) res.setHeader('x-request-id', id);
  return id;
}

/**
 * Xác định `traceId` cho phân tán trace: ưu tiên W3C `traceparent`, sau đó `x-trace-id`,
 * hoặc sinh mới chuỗi 32 hex (128-bit) theo chuẩn OpenTelemetry/W3C.
 */
export function resolveTraceId(req: IncomingMessage, res: ServerResponse): string {
  const traceId =
    parseTraceParent(readHeader(req, 'traceparent')) ??
    readHeader(req, 'x-trace-id') ??
    randomBytes(16).toString('hex');
  if (!res.headersSent) res.setHeader('x-trace-id', traceId);
  return traceId;
}
