export const HTTP_LOG_META_SYMBOL = Symbol.for('core:http_log_meta');

export interface HttpLogMeta {
  startedAt: number;
  requestId: string;
  correlationId: string;
  traceId: string;
  module?: string;
  action?: string;
  reqBody?: Record<string, unknown>;
}

type RequestWithLogMeta = {
  [HTTP_LOG_META_SYMBOL]?: HttpLogMeta;
};

/** Đọc metadata logging gắn trên HTTP request gốc (`IncomingMessage`). */
export function getHttpLogMeta(req: unknown): HttpLogMeta | undefined {
  if (!req || typeof req !== 'object') return undefined;
  return (req as RequestWithLogMeta)[HTTP_LOG_META_SYMBOL];
}

/** Cập nhật metadata logging gắn trên HTTP request gốc để `pino-http` dùng khi hoàn tất response. */
export function setHttpLogMeta(req: unknown, patch: Partial<HttpLogMeta>): void {
  if (!req || typeof req !== 'object') return;
  const target = req as RequestWithLogMeta;
  const prev = target[HTTP_LOG_META_SYMBOL] ?? {
    startedAt: Date.now(),
    requestId: '',
    correlationId: '',
    traceId: '',
  };
  target[HTTP_LOG_META_SYMBOL] = { ...prev, ...patch };
}
