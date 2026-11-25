import { AppException, ERROR_CATEGORY, type MessageParams } from './app.exception.js';
import { DomainException } from './domain.exception.js';
import { HTTP_STATUS_CODE } from './http-exceptions.js';

export const DOMAIN_EVENT_ERROR_CODE = {
  INVALID_NAME: 'DOMAIN_EVENT_INVALID_NAME',
  INVALID_VERSION: 'DOMAIN_EVENT_INVALID_VERSION',
  ENTITY_LEAK: 'DOMAIN_EVENT_ENTITY_LEAK',
  SECRET_LEAK: 'DOMAIN_EVENT_SECRET_LEAK',
  INVALID_PAYLOAD: 'DOMAIN_EVENT_INVALID_PAYLOAD',
  REQUIRED_HANDLER_FAILED: 'DOMAIN_EVENT_REQUIRED_HANDLER_FAILED',
} as const;

export type DomainEventErrorCode =
  (typeof DOMAIN_EVENT_ERROR_CODE)[keyof typeof DOMAIN_EVENT_ERROR_CODE];

export type DomainEventPayloadViolationKind =
  | 'entity_leak'
  | 'secret_leak'
  | 'invalid_payload';

/**
 * Lỗi vi phạm quy tắc đặt tên Domain Event (yêu cầu PascalCase chuẩn như `UserCreated`
 * hoặc `dot.snake_case` hợp lệ như `user.created`).
 */
export class DomainEventNamingViolationException extends DomainException {
  public readonly rawEventName: string;

  constructor(rawEventName: string, reason: string) {
    super(
      DOMAIN_EVENT_ERROR_CODE.INVALID_NAME,
      DOMAIN_EVENT_ERROR_CODE.INVALID_NAME,
      [{ field: 'type', value: rawEventName, reason }],
      { eventName: rawEventName, reason },
    );
    this.rawEventName = rawEventName;
  }
}

/**
 * Lỗi vi phạm chính sách dữ liệu đưa vào Domain Event (chặn ORM Entity, class instance,
 * trường nhạy cảm/secret hoặc payload quá lớn/vòng lặp).
 */
export class DomainEventPayloadViolationException extends DomainException {
  public readonly violationKind: DomainEventPayloadViolationKind;
  public readonly fieldPath: string;

  constructor(params: {
    readonly code: DomainEventErrorCode;
    readonly violationKind: DomainEventPayloadViolationKind;
    readonly fieldPath: string;
    readonly reason: string;
    readonly messageParams?: MessageParams;
  }) {
    super(
      params.code,
      params.code,
      [
        {
          field: params.fieldPath,
          violationKind: params.violationKind,
          reason: params.reason,
        },
      ],
      params.messageParams ?? { field: params.fieldPath, reason: params.reason },
    );
    this.violationKind = params.violationKind;
    this.fieldPath = params.fieldPath;
  }
}

export interface RequiredHandlerFailureDetail {
  readonly handlerId: string;
  readonly module: string;
  readonly errorName: string;
  readonly errorMessage: string;
}

/**
 * Lỗi khi ít nhất một Event Handler bắt buộc (`criticality: 'required'`) thất bại.
 */
export class DomainEventRequiredHandlerException extends AppException {
  public override readonly code = DOMAIN_EVENT_ERROR_CODE.REQUIRED_HANDLER_FAILED;
  public readonly eventId: string;
  public readonly eventType: string;
  public readonly failures: readonly RequiredHandlerFailureDetail[];

  constructor(params: {
    readonly eventId: string;
    readonly eventType: string;
    readonly failures: readonly RequiredHandlerFailureDetail[];
    readonly cause?: unknown;
  }) {
    const first = params.failures[0];
    super(
      DOMAIN_EVENT_ERROR_CODE.REQUIRED_HANDLER_FAILED,
      HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR,
      [...params.failures],
      {
        eventType: params.eventType,
        handlerId: first?.handlerId ?? 'unknown',
        reason: first?.errorMessage ?? 'unknown error',
      },
      ERROR_CATEGORY.SYSTEM,
      false,
    );
    this.eventId = params.eventId;
    this.eventType = params.eventType;
    this.failures = params.failures;
    if (params.cause !== undefined) {
      this.cause = params.cause;
    }
  }
}
