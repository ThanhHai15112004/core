export type JobOperationErrorCode =
  | 'RETRY_DISABLED'
  | 'CANCEL_DISABLED'
  | 'REMOVE_DISABLED'
  | 'PAYLOAD_DISABLED'
  | 'UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'NON_RETRYABLE'
  | 'NOT_CANCELLABLE'
  | 'NO_WORKER'
  | 'TOO_MANY'
  | 'FAILED';

/** Thao tác job bị từ chối / thất bại; `code` ánh xạ sang i18n key ở tầng API. */
export class JobOperationError extends Error {
  constructor(
    public readonly code: JobOperationErrorCode,
    message: string = code,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}
