export type QueueOperationErrorCode =
  | 'PAUSE_DISABLED'
  | 'RETRY_DISABLED'
  | 'DRAIN_DISABLED'
  | 'UNSUPPORTED'
  | 'UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'TOO_MANY'
  | 'CHANGED'
  | 'FAILED';

/** Thao tác queue bị từ chối / thất bại; `code` ánh xạ sang i18n key ở tầng API. */
export class QueueOperationError extends Error {
  constructor(
    public readonly code: QueueOperationErrorCode,
    message: string = code,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}
