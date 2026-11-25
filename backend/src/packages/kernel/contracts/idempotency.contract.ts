/**
 * Hợp đồng chuẩn cho cơ chế chống xử lý trùng (Idempotency — Phase 11.3).
 * Đặt tại `@packages/kernel` để mọi module nghiệp vụ, HTTP Interceptor, BullMQ Worker,
 * Inbound Webhook và Domain Event Bus dùng chung mà không tạo phụ thuộc chéo vào `IdempotencyModule`.
 */

export const IDEMPOTENCY_PORT = Symbol('IDEMPOTENCY_PORT');

export const IDEMPOTENCY_SCOPE = {
  /** Chống tạo bản ghi trùng khi gọi HTTP API nhiều lần (Idempotency-Key). */
  API: 'API',
  /** Chống xử lý Background Job trùng theo khóa nghiệp vụ. */
  JOB: 'JOB',
  /** Chống xử lý Webhook đối tác trùng theo Event ID của provider. */
  WEBHOOK: 'WEBHOOK',
  /** Chống xử lý Domain Event trùng theo danh sách Event đã xử lý (Inbox Pattern). */
  EVENT: 'EVENT',
} as const;

export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPE)[keyof typeof IDEMPOTENCY_SCOPE];

export const IDEMPOTENCY_SCOPES: readonly IdempotencyScope[] = [
  IDEMPOTENCY_SCOPE.API,
  IDEMPOTENCY_SCOPE.JOB,
  IDEMPOTENCY_SCOPE.WEBHOOK,
  IDEMPOTENCY_SCOPE.EVENT,
] as const;

export const IDEMPOTENCY_STATUS = {
  /** Đang xử lý (đã giữ khóa chống race condition). */
  IN_PROGRESS: 1,
  /** Đã xử lý xong thành công — lần gọi lại khớp fingerprint sẽ replay / skip. */
  COMPLETED: 2,
  /** Xử lý thất bại — cho phép thử lại cùng khóa nghiệp vụ. */
  FAILED: 3,
} as const;

export type IdempotencyStatusCode = (typeof IDEMPOTENCY_STATUS)[keyof typeof IDEMPOTENCY_STATUS];

export type IdempotencyStatusName = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export const IDEMPOTENCY_OUTCOME = {
  /** Giành được khóa xử lý mới (hoặc thay thế khóa hết hạn / lỗi trước đó). */
  ACQUIRED: 'ACQUIRED',
  /** Trùng khóa và khớp dữ liệu với bản ghi đã hoàn tất — replay kết quả hoặc skip an toàn. */
  REPLAYED: 'REPLAYED',
  /** Khóa đang được luồng khác xử lý đồng thời (chưa hết lease). */
  IN_PROGRESS: 'IN_PROGRESS',
  /** Trùng khóa nhưng dữ liệu đầu vào (payload/fingerprint) khác với bản ghi gốc. */
  PAYLOAD_MISMATCH: 'PAYLOAD_MISMATCH',
} as const;

export type IdempotencyOutcome = (typeof IDEMPOTENCY_OUTCOME)[keyof typeof IDEMPOTENCY_OUTCOME];

export const IDEMPOTENCY_ALERT_STATUS = {
  HEALTHY: 'HEALTHY',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;

export type IdempotencyAlertStatus =
  (typeof IDEMPOTENCY_ALERT_STATUS)[keyof typeof IDEMPOTENCY_ALERT_STATUS];

export const IDEMPOTENCY_QUEUE_TOPICS = {
  CLEANUP_TICK: 'idempotency.cleanup.tick',
} as const;

export type IdempotencyQueueTopic =
  (typeof IDEMPOTENCY_QUEUE_TOPICS)[keyof typeof IDEMPOTENCY_QUEUE_TOPICS];

export const IDEMPOTENCY_DEFAULTS = {
  HEADER_NAME: 'idempotency-key',
  REPLAYED_HEADER_NAME: 'Idempotency-Replayed',
  API_TTL_SEC: 86_400, // 24 giờ
  JOB_TTL_SEC: 86_400, // 24 giờ
  WEBHOOK_TTL_SEC: 604_800, // 7 ngày
  EVENT_TTL_SEC: 604_800, // 7 ngày
  LOCK_LEASE_SEC: 60,
  MAX_KEY_LENGTH: 200,
  MAX_SCOPE_TARGET_LENGTH: 200,
  MAX_RESPONSE_BYTES: 262_144, // 256 KB
  CLEANUP_BATCH_SIZE: 1000,
  DUPLICATE_RATE_WARN_PERCENT: 15,
  DUPLICATE_RATE_CRIT_PERCENT: 35,
  CLIENT_REPEAT_WARN_HITS: 10,
  CLIENT_REPEAT_CRIT_HITS: 50,
  DEFAULT_METRICS_WINDOW_HOURS: 24,
} as const;

export interface IdempotencyStoredResponse {
  readonly statusCode: number | null;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

export interface IdempotencyAcquireInput {
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly ttlSec?: number | undefined;
  readonly leaseSec?: number | undefined;
  readonly lockOwner?: string | null | undefined;
  readonly clientIdentifier?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  /** Cho phép cùng `lockOwner` (vd retry cùng `jobId`) chạy tiếp nếu bản ghi đang `IN_PROGRESS`. */
  readonly allowSameOwnerRetry?: boolean | undefined;
  readonly now?: Date | undefined;
}

export interface IdempotencyAcquireResult {
  readonly outcome: IdempotencyOutcome;
  readonly recordId: number | null;
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly storedFingerprint: string | null;
  readonly response: IdempotencyStoredResponse | null;
  readonly duplicateHits: number;
  readonly conflictHits: number;
  readonly lockOwner: string | null;
  readonly expiresAt: string;
  readonly persisted: boolean;
}

export interface IdempotencyCompleteInput {
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly recordId?: number | null | undefined;
  readonly lockOwner?: string | null | undefined;
  readonly statusCode?: number | null | undefined;
  readonly responseBody?: unknown;
  readonly responseHeaders?: Record<string, string> | undefined;
  readonly now?: Date | undefined;
}

export interface IdempotencyFailInput {
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly recordId?: number | null | undefined;
  readonly lockOwner?: string | null | undefined;
  readonly errorCode?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly now?: Date | undefined;
}

export interface IdempotencyRecordExternalInput {
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly outcome: 'CREATED' | 'DUPLICATE' | 'PAYLOAD_MISMATCH';
  readonly ttlSec?: number | undefined;
  readonly clientIdentifier?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  readonly statusCode?: number | null | undefined;
  readonly responseBody?: unknown;
  readonly errorMessage?: string | null | undefined;
  readonly now?: Date | undefined;
}

export interface IdempotencyExecuteInput<T> {
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly requestFingerprint?: string | undefined;
  readonly ttlSec?: number | undefined;
  readonly leaseSec?: number | undefined;
  readonly lockOwner?: string | null | undefined;
  readonly clientIdentifier?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  readonly allowSameOwnerRetry?: boolean | undefined;
  readonly statusCode?: number | null | undefined;
  readonly run: () => Promise<T>;
}

export interface IdempotencyExecuteResult<T> {
  readonly duplicate: boolean;
  readonly recordId: number | null;
  readonly result: T;
  readonly duplicateHits: number;
  readonly persisted: boolean;
}

export interface IdempotencyGuardWebhookInput<T> {
  readonly providerCode: string;
  readonly externalEventId: string;
  readonly payload: unknown;
  readonly payloadHash?: string | undefined;
  readonly ttlSec?: number | undefined;
  readonly correlationId?: string | null | undefined;
  readonly run: () => Promise<T>;
}

export interface IdempotencyScopeMetrics {
  readonly scope: IdempotencyScope;
  readonly uniqueKeys: number;
  readonly inProgressCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly duplicateHits: number;
  readonly conflictHits: number;
  readonly totalRequests: number;
  readonly duplicateRatePercent: number;
  readonly conflictRatePercent: number;
}

export interface IdempotencyClientRepeatSummary {
  readonly clientIdentifier: string;
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly uniqueKeys: number;
  readonly duplicateHits: number;
  readonly conflictHits: number;
  readonly totalRequests: number;
  readonly duplicateRatePercent: number;
  readonly lastDuplicateAt: string | null;
  readonly suspicious: boolean;
  readonly severity: IdempotencyAlertStatus;
}

export interface IdempotencyMetricsSnapshot {
  readonly windowHours: number;
  readonly totalUniqueKeys: number;
  readonly activeKeysCount: number;
  readonly expiredPendingPurgeCount: number;
  readonly totalDuplicateHits: number;
  readonly totalConflictHits: number;
  readonly totalRequests: number;
  readonly duplicateRatePercent: number;
  readonly conflictRatePercent: number;
  readonly alertStatus: IdempotencyAlertStatus;
  readonly alertReasons: readonly string[];
  readonly byScope: readonly IdempotencyScopeMetrics[];
  readonly topRepeatedClients: readonly IdempotencyClientRepeatSummary[];
  readonly thresholds: {
    readonly duplicateRateWarnPercent: number;
    readonly duplicateRateCritPercent: number;
    readonly clientRepeatWarnHits: number;
    readonly clientRepeatCritHits: number;
  };
  readonly observedAt: string;
}

export interface IIdempotencyStoreDelegate {
  acquire(input: IdempotencyAcquireInput): Promise<IdempotencyAcquireResult>;
  complete(input: IdempotencyCompleteInput): Promise<void>;
  fail(input: IdempotencyFailInput): Promise<void>;
  recordExternalObservation(input: IdempotencyRecordExternalInput): Promise<void>;
  getMetricsSnapshot(windowHours?: number): Promise<IdempotencyMetricsSnapshot>;
}

export interface IIdempotencyPort {
  isReady(): boolean;
  acquire(input: IdempotencyAcquireInput): Promise<IdempotencyAcquireResult>;
  complete(input: IdempotencyCompleteInput): Promise<void>;
  fail(input: IdempotencyFailInput): Promise<void>;
  recordExternalObservation(input: IdempotencyRecordExternalInput): Promise<void>;
  execute<T>(input: IdempotencyExecuteInput<T>): Promise<IdempotencyExecuteResult<T>>;
  guardWebhook<T>(input: IdempotencyGuardWebhookInput<T>): Promise<IdempotencyExecuteResult<T>>;
  getMetricsSnapshot(windowHours?: number): Promise<IdempotencyMetricsSnapshot | null>;
}

export function getIdempotencyStatusName(status: number): IdempotencyStatusName {
  switch (status) {
    case IDEMPOTENCY_STATUS.COMPLETED:
      return 'COMPLETED';
    case IDEMPOTENCY_STATUS.FAILED:
      return 'FAILED';
    case IDEMPOTENCY_STATUS.IN_PROGRESS:
    default:
      return 'IN_PROGRESS';
  }
}

export function parseIdempotencyStatus(raw: unknown): IdempotencyStatusCode | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw >= IDEMPOTENCY_STATUS.IN_PROGRESS && raw <= IDEMPOTENCY_STATUS.FAILED) {
      return raw as IdempotencyStatusCode;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toUpperCase();
    if (/^\d+$/.test(trimmed)) {
      return parseIdempotencyStatus(Number(trimmed));
    }
    switch (trimmed) {
      case 'IN_PROGRESS':
      case 'IN-PROGRESS':
      case 'PROCESSING':
        return IDEMPOTENCY_STATUS.IN_PROGRESS;
      case 'COMPLETED':
      case 'SUCCEEDED':
      case 'DONE':
        return IDEMPOTENCY_STATUS.COMPLETED;
      case 'FAILED':
      case 'ERROR':
        return IDEMPOTENCY_STATUS.FAILED;
      default:
        return null;
    }
  }
  return null;
}

export function parseIdempotencyScope(raw: unknown): IdempotencyScope | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (
    upper === IDEMPOTENCY_SCOPE.API ||
    upper === IDEMPOTENCY_SCOPE.JOB ||
    upper === IDEMPOTENCY_SCOPE.WEBHOOK ||
    upper === IDEMPOTENCY_SCOPE.EVENT
  ) {
    return upper;
  }
  return null;
}
