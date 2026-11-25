import { BadRequestAppException, ConflictAppException } from './http-exceptions.js';
import type { IdempotencyScope } from '../contracts/idempotency.contract.js';

export const IDEMPOTENCY_ERROR_CODE = {
  KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  PAYLOAD_MISMATCH: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
  IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
} as const;

export type IdempotencyErrorCode =
  (typeof IDEMPOTENCY_ERROR_CODE)[keyof typeof IDEMPOTENCY_ERROR_CODE];

export interface IdempotencyConflictDetail {
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly reason?: string | undefined;
}

/**
 * Lỗi 409 Conflict — Cùng Idempotency Key nhưng dữ liệu đầu vào (payload/fingerprint) khác với bản ghi gốc.
 * Đồng nhất mã HTTP 409 với `payments` và `inbound-webhooks` trong toàn hệ thống.
 */
export class IdempotencyPayloadMismatchException extends ConflictAppException {
  public readonly detail: IdempotencyConflictDetail;

  constructor(detail: IdempotencyConflictDetail) {
    super(
      IDEMPOTENCY_ERROR_CODE.PAYLOAD_MISMATCH,
      [detail],
      {
        scope: detail.scope,
        scopeTarget: detail.scopeTarget,
        idempotencyKey: detail.idempotencyKey,
      },
      IDEMPOTENCY_ERROR_CODE.PAYLOAD_MISMATCH,
    );
    this.detail = detail;
  }
}

/**
 * Lỗi 409 Conflict — Một yêu cầu khác có cùng Idempotency Key đang được xử lý đồng thời.
 */
export class IdempotencyInProgressException extends ConflictAppException {
  public readonly detail: IdempotencyConflictDetail;

  constructor(detail: IdempotencyConflictDetail) {
    super(
      IDEMPOTENCY_ERROR_CODE.IN_PROGRESS,
      [detail],
      {
        scope: detail.scope,
        scopeTarget: detail.scopeTarget,
        idempotencyKey: detail.idempotencyKey,
      },
      IDEMPOTENCY_ERROR_CODE.IN_PROGRESS,
    );
    this.detail = detail;
  }
}

/** Lỗi 400 Bad Request — Endpoint yêu cầu bắt buộc header `Idempotency-Key` nhưng client không gửi. */
export class IdempotencyKeyRequiredException extends BadRequestAppException {
  constructor(headerName: string) {
    super(
      IDEMPOTENCY_ERROR_CODE.KEY_REQUIRED,
      [{ headerName }],
      { headerName },
      IDEMPOTENCY_ERROR_CODE.KEY_REQUIRED,
    );
  }
}

/** Lỗi 400 Bad Request — Giá trị `Idempotency-Key` không hợp lệ (rỗng, quá dài hoặc chứa ký tự điều khiển). */
export class IdempotencyKeyInvalidException extends BadRequestAppException {
  constructor(headerName: string, maxLength: number) {
    super(
      IDEMPOTENCY_ERROR_CODE.KEY_INVALID,
      [{ headerName, maxLength }],
      { headerName, maxLength },
      IDEMPOTENCY_ERROR_CODE.KEY_INVALID,
    );
  }
}
