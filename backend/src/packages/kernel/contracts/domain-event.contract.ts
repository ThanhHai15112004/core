/**
 * Hợp đồng chuẩn cho Domain Event nội bộ hệ thống (Phase 11.1).
 * Đặt tại `@packages/kernel` để mọi module nghiệp vụ có thể phát & lắng nghe sự kiện
 * mà không phụ thuộc chéo vào nhau hay phụ thuộc tầng transport (BullMQ/HTTP).
 */

export const DOMAIN_EVENT_BUS_PORT = Symbol('DOMAIN_EVENT_BUS_PORT');

export const DOMAIN_EVENT_CRITICALITY = {
  /** Handler bắt buộc: thất bại sẽ ghi log error và ném lỗi để rollback/dừng luồng chính. */
  REQUIRED: 'required',
  /** Handler phụ: thất bại sẽ ghi log warn, không làm gián đoạn luồng chính hay các handler khác. */
  OPTIONAL: 'optional',
} as const;

export type DomainEventCriticality =
  (typeof DOMAIN_EVENT_CRITICALITY)[keyof typeof DOMAIN_EVENT_CRITICALITY];

export interface DomainEventMetadata {
  /** Request ID (từ HTTP `X-Request-Id` hoặc tác vụ gốc) để truy vết nguồn phát sinh. */
  readonly requestId: string | null;
  /** Correlation ID xuyên suốt request / job / sự kiện liên chuỗi. */
  readonly correlationId: string | null;
  /** ID của sự kiện cha nếu sự kiện này được phát từ một handler khác. */
  readonly causationId: string | null;
  /** Định danh tác nhân thực hiện hành động (nếu có). */
  readonly actorId: string | number | null;
  /** Tên module phát sinh sự kiện (kebab-case, khớp `module.manifest.json`). */
  readonly sourceModule: string;
  /** Tên sự kiện dạng `dot.snake_case` (vd `user.created`) tương thích manifest & webhook matcher. */
  readonly dotName: string;
}

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  /** Mã định danh duy nhất của sự kiện (UUID v4). */
  readonly id: string;
  /** Tên sự kiện chuẩn PascalCase (vd `UserCreated`, `OrderApproved`). */
  readonly type: string;
  /** Phiên bản cấu trúc payload (>= 1) phục vụ tiến hóa schema an toàn. */
  readonly version: number;
  /** Thời điểm phát sinh sự kiện (ISO-8601 UTC). */
  readonly occurredAt: string;
  /** ID của aggregate liên quan (tùy chọn, vd userId / orderId). */
  readonly aggregateId: string | null;
  /** Loại aggregate liên quan (tùy chọn, vd `'User'`, `'Order'`). */
  readonly aggregateType: string | null;
  /** Dữ liệu tối giản đã kiểm định sạch (không ORM entity, không secret). */
  readonly payload: Readonly<TPayload>;
  /** Metadata truy vết & nguồn gốc sự kiện. */
  readonly metadata: DomainEventMetadata;
}

export interface CreateDomainEventInput<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Tên sự kiện (ưu tiên PascalCase `UserCreated`; chấp nhận `user.created` và tự chuẩn hóa). */
  readonly type: string;
  /** Phiên bản payload (mặc định `1`). */
  readonly version?: number | undefined;
  /** Module phát sinh sự kiện (vd `'users'`, `'orders'`). */
  readonly sourceModule: string;
  /** Dữ liệu sự kiện tối giản (plain DTO, cấm ORM Entity & secret). */
  readonly payload: TPayload;
  /** Tên dạng `dot.snake_case` tường minh (nếu khác quy tắc chuyển mặc định, vd `custom-fields.definition.created`). */
  readonly dotName?: string | undefined;
  readonly id?: string | undefined;
  readonly occurredAt?: string | undefined;
  readonly aggregateId?: string | number | null | undefined;
  readonly aggregateType?: string | null | undefined;
  readonly requestId?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  readonly causationId?: string | null | undefined;
  readonly actorId?: string | number | null | undefined;
}

export type DomainEventHandler<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  (event: DomainEvent<TPayload>) => Promise<void> | void;

export interface DomainEventHandlerRegistration<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Mã định danh duy nhất của handler (vd `'webhooks.domain_event_bridge'`). */
  readonly id: string;
  /** Tên module đăng ký handler (vd `'webhooks'`, `'notifications'`). */
  readonly module: string;
  /**
   * Mẫu sự kiện lắng nghe:
   * - PascalCase chính xác (`'UserCreated'`)
   * - Dot-name chính xác (`'user.created'`)
   * - Wildcard tiền tố (`'user.*'`, `'User*'`) hoặc toàn bộ (`'*'`)
   */
  readonly eventPattern: string;
  /** Mức độ quan trọng: `'required'` (lỗi bắt buộc) hoặc `'optional'` (lỗi phụ). Mặc định `'optional'`. */
  readonly criticality?: DomainEventCriticality | undefined;
  /**
   * Chống xử lý trùng theo cặp `(handlerId, event.id)` (Phase 11.3 — Inbox Pattern):
   * - `true`: luôn kiểm tra danh sách Event đã xử lý trước khi chạy handler.
   * - `false`: tắt khử trùng riêng cho handler này ngay cả khi `publish` bật `enforceIdempotency`.
   * - `undefined`: tự động khử trùng khi `publish` bật `enforceIdempotency` (vd event từ Outbox Worker).
   */
  readonly idempotent?: boolean | undefined;
  /** Thời gian lưu vết Event đã xử lý riêng cho handler này (giây). */
  readonly idempotencyTtlSec?: number | undefined;
  readonly description?: string | undefined;
  readonly handler: DomainEventHandler<TPayload>;
}

export interface DomainEventPublishOptions {
  /** Bật chống xử lý Event trùng cho tất cả handler không đặt `idempotent: false` (dùng cho Outbox/Worker relay). */
  readonly enforceIdempotency?: boolean | undefined;
  /** Định danh nguồn phát/chuyển tiếp phục vụ theo dõi tỷ lệ event trùng (vd `outbox:relay`). */
  readonly clientIdentifier?: string | null | undefined;
  /** Thời gian lưu vết Event đã xử lý mặc định cho lần phát này (giây). */
  readonly idempotencyTtlSec?: number | undefined;
}

export interface DomainEventHandlerExecutionResult {
  readonly handlerId: string;
  readonly module: string;
  readonly criticality: DomainEventCriticality;
  readonly status: 'succeeded' | 'failed' | 'skipped_duplicate';
  readonly durationMs: number;
  readonly skippedReason?: string | undefined;
  readonly errorName?: string | undefined;
  readonly errorMessage?: string | undefined;
}

export interface DomainEventDispatchReport<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly event: DomainEvent<TPayload>;
  readonly matchedHandlers: number;
  readonly succeededCount: number;
  readonly skippedDuplicateCount?: number | undefined;
  readonly failedRequiredCount: number;
  readonly failedOptionalCount: number;
  readonly results: readonly DomainEventHandlerExecutionResult[];
}

export interface DomainEventContextSnapshot {
  readonly requestId?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  readonly actorId?: string | number | null | undefined;
}

export type DomainEventContextResolver = () => DomainEventContextSnapshot | undefined;

export interface DomainEventLogger {
  log(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface DomainEventHandlerStats {
  readonly id: string;
  readonly module: string;
  readonly eventPattern: string;
  readonly criticality: DomainEventCriticality;
  readonly description: string | null;
  readonly registeredAt: string;
  readonly invokedCount: number;
  readonly succeededCount: number;
  readonly skippedDuplicateCount?: number | undefined;
  readonly failedCount: number;
  readonly lastInvokedAt: string | null;
  readonly lastErrorAt: string | null;
  readonly lastErrorMessage: string | null;
}

export interface DomainEventRecentDispatch {
  readonly id: string;
  readonly type: string;
  readonly dotName: string;
  readonly version: number;
  readonly sourceModule: string;
  readonly occurredAt: string;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly matchedHandlers: number;
  readonly succeededCount: number;
  readonly skippedDuplicateCount?: number | undefined;
  readonly failedRequiredCount: number;
  readonly failedOptionalCount: number;
}

export interface DomainEventRuntimeSnapshot {
  readonly totalPublished: number;
  readonly totalHandlerInvocations: number;
  readonly totalRequiredFailures: number;
  readonly totalOptionalFailures: number;
  readonly handlers: readonly DomainEventHandlerStats[];
  readonly recentDispatches: readonly DomainEventRecentDispatch[];
}

export interface IDomainEventBus {
  registerHandler<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    registration: DomainEventHandlerRegistration<TPayload>,
  ): () => void;
  unregisterHandler(handlerId: string): boolean;
  publish<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    input: CreateDomainEventInput<TPayload> | DomainEvent<TPayload>,
    options?: DomainEventPublishOptions,
  ): Promise<DomainEventDispatchReport<TPayload>>;
  listHandlers(): readonly DomainEventHandlerStats[];
  getSnapshot(): DomainEventRuntimeSnapshot;
}
