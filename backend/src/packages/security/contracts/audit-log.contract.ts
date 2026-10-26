import type { UserIdentity } from './auth.contract.js';

/**
 * Mã số nguyên loại chủ thể thực hiện thao tác (Mục 4.4.1 — Lưu User ID hoặc Service Account):
 * - 1 = USER (Người dùng hệ thống)
 * - 2 = SERVICE_ACCOUNT (Tài khoản hệ thống / API Client M2M)
 * - 3 = SYSTEM (Tác vụ tự động của hệ thống / CLI / Worker)
 */
export const AUDIT_ACTOR_TYPE = {
  USER: 1,
  SERVICE_ACCOUNT: 2,
  SYSTEM: 3,
} as const;

export type AuditActorTypeCode = (typeof AUDIT_ACTOR_TYPE)[keyof typeof AUDIT_ACTOR_TYPE];
export type AuditActorTypeName = keyof typeof AUDIT_ACTOR_TYPE;

/** Chuyển đổi mã số nguyên loại chủ thể sang tên hiển thị chuẩn */
export function getAuditActorTypeName(code: number): AuditActorTypeName {
  switch (code) {
    case AUDIT_ACTOR_TYPE.SERVICE_ACCOUNT:
      return 'SERVICE_ACCOUNT';
    case AUDIT_ACTOR_TYPE.SYSTEM:
      return 'SYSTEM';
    case AUDIT_ACTOR_TYPE.USER:
    default:
      return 'USER';
  }
}

/** Chuẩn hóa giá trị đầu vào (số hoặc chuỗi) về mã AuditActorTypeCode */
export function parseAuditActorType(
  value: unknown,
  fallback: AuditActorTypeCode = AUDIT_ACTOR_TYPE.USER,
): AuditActorTypeCode {
  if (typeof value === 'number') {
    if (
      value === AUDIT_ACTOR_TYPE.USER ||
      value === AUDIT_ACTOR_TYPE.SERVICE_ACCOUNT ||
      value === AUDIT_ACTOR_TYPE.SYSTEM
    ) {
      return value;
    }
    return fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const asInt = Number(trimmed);
    if (!Number.isNaN(asInt)) {
      return parseAuditActorType(asInt, fallback);
    }
    const upper = trimmed.toUpperCase();
    if (upper === 'SERVICE_ACCOUNT' || upper === 'API_CLIENT' || upper === 'M2M') {
      return AUDIT_ACTOR_TYPE.SERVICE_ACCOUNT;
    }
    if (upper === 'SYSTEM' || upper === 'CRON' || upper === 'WORKER') {
      return AUDIT_ACTOR_TYPE.SYSTEM;
    }
    if (upper === 'USER') {
      return AUDIT_ACTOR_TYPE.USER;
    }
  }
  return fallback;
}

const SENSITIVE_AUDIT_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'passwordhistoryhashesjson',
  'password_history_hashes_json',
  'currentpassword',
  'newpassword',
  'secret',
  'clientsecret',
  'client_secret',
  'secretencrypted',
  'secret_encrypted',
  'totpsecret',
  'recoverycodes',
  'recoverycodeshashesjson',
  'token',
  'accesstoken',
  'refreshtoken',
  'stepuptoken',
  'mfaactiontoken',
  'otp',
  'otpcode',
  'codehash',
]);

/**
 * Làm sạch dữ liệu Trước/Sau khi thay đổi (Mục 4.4.4) để che các trường nhạy cảm
 * (mật khẩu, secret, token, mã OTP) trước khi lưu vào Audit Log.
 */
export function sanitizeAuditSnapshot(value: unknown, depth = 0): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (depth > 5) return { _truncated: true };
  if (typeof value !== 'object') {
    return { value };
  }
  if (value instanceof Date) {
    return { value: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return {
      items: value.map((item) =>
        item !== null && typeof item === 'object' && !(item instanceof Date)
          ? sanitizeAuditSnapshot(item, depth + 1)
          : item instanceof Date
            ? item.toISOString()
            : item,
      ),
    };
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (SENSITIVE_AUDIT_KEYS.has(normalizedKey)) {
      result[key] = '[REDACTED]';
      continue;
    }
    if (val instanceof Date) {
      result[key] = val.toISOString();
    } else if (Array.isArray(val)) {
      result[key] = val.map((item) =>
        item !== null && typeof item === 'object' && !(item instanceof Date)
          ? sanitizeAuditSnapshot(item, depth + 1)
          : item instanceof Date
            ? item.toISOString()
            : item,
      );
    } else if (val !== null && typeof val === 'object') {
      result[key] = sanitizeAuditSnapshot(val, depth + 1);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/** Dữ liệu đầu vào khi ghi một bản ghi Nhật ký thao tác (Audit Log — Mục 4.4) */
export interface RecordAuditLogInput {
  /** Chủ thể thực hiện (nếu không truyền sẽ tự động lấy từ RequestContext) */
  readonly actor?: UserIdentity | null | undefined;
  readonly actorType?: AuditActorTypeCode | string | undefined;
  readonly actorUserId?: number | null | undefined;
  readonly actorId?: number | null | undefined;
  readonly actorServiceAccountId?: number | null | undefined;
  readonly actorApiClientId?: number | null | undefined;
  readonly actorIdentifier?: string | null | undefined;
  /** Module nghiệp vụ phát sinh thao tác (vd: 'users', 'roles', 'organizations', 'auth') */
  readonly module: string;
  /** Chức năng cụ thể trong module (vd: 'user_management', 'role_management', 'service_account') */
  readonly feature: string;
  /** Mã hành động (vd: 'USER_CREATED', 'USER_UNLOCKED', 'ROLE_UPDATED', 'API_CLIENT_REVOKED') */
  readonly action: string;
  /** Loại tài nguyên bị tác động (vd: 'user', 'role', 'organization_unit', 'api_client') */
  readonly resourceType?: string | null | undefined;
  /** ID của bản ghi bị tác động */
  readonly resourceId?: string | number | null | undefined;
  /** Dữ liệu trước khi thay đổi (áp dụng với dữ liệu quan trọng — Mục 4.4.4) */
  readonly beforeData?: unknown;
  /** Dữ liệu sau khi thay đổi (áp dụng với dữ liệu quan trọng — Mục 4.4.4) */
  readonly afterData?: unknown;
  /** Lý do thực hiện thay đổi (vd: lý do mở khóa tài khoản, sửa dữ liệu, reset MFA — Mục 4.4.5) */
  readonly reason?: string | null | undefined;
  /** Địa chỉ IP của người thực hiện (tự động điền từ RequestContext nếu không truyền — Mục 4.4.2) */
  readonly ipAddress?: string | null | undefined;
  /** Thông tin trình duyệt/thiết bị */
  readonly userAgent?: string | null | undefined;
  /** Request ID (tự động điền từ RequestContext — Mục 4.4.6) */
  readonly requestId?: string | null | undefined;
  /** Correlation ID liên kết với Pino Log & BullMQ Queue (tự động điền từ RequestContext — Mục 4.4.6) */
  readonly correlationId?: string | null | undefined;
}

/** Cấu trúc bản ghi Audit Log chuẩn đã chuẩn hóa */
export interface AuditLogRecord {
  readonly id: number;
  readonly actorType: AuditActorTypeCode;
  readonly actorTypeName: AuditActorTypeName;
  readonly actorUserId: number | null;
  readonly actorServiceAccountId: number | null;
  readonly actorApiClientId: number | null;
  readonly actorIdentifier: string | null;
  readonly module: string;
  readonly feature: string;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly beforeData: Record<string, unknown> | null;
  readonly afterData: Record<string, unknown> | null;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

/** Bộ lọc tra cứu Audit Log (Mục 4.4.7 & 8.1 — Lọc theo người dùng, Service Account, module, thời gian, hành động, sắp xếp và chọn trường) */
export interface AuditLogQueryFilter {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly q?: string | undefined;
  readonly search?: string | undefined;
  readonly actorType?: AuditActorTypeCode | undefined;
  readonly actorUserId?: number | undefined;
  readonly actorServiceAccountId?: number | undefined;
  readonly module?: string | undefined;
  readonly feature?: string | undefined;
  readonly action?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly fromDate?: string | Date | undefined;
  readonly toDate?: string | Date | undefined;
  readonly sortBy?: 'id' | 'createdAt' | 'module' | 'action' | undefined;
  readonly sortOrder?: 'ASC' | 'DESC' | undefined;
  readonly sort?: string | undefined;
  readonly fields?: readonly string[] | undefined;
}

/** Kết quả phân trang khi tra cứu Audit Log */
export interface AuditLogPaginatedResult {
  readonly data: readonly AuditLogRecord[];
  readonly meta: {
    readonly page: number;
    readonly limit: number;
    readonly totalItems: number;
    readonly totalPages: number;
  };
}

/** Cổng lưu trữ bền vững (Persistence Port) do tầng module đăng ký vào AuditLogService */
export interface IAuditLogPersistencePort {
  saveRecord(record: Omit<AuditLogRecord, 'id' | 'createdAt'>): Promise<AuditLogRecord>;
  findById(id: number): Promise<AuditLogRecord | null>;
  searchPaginated(filter: AuditLogQueryFilter): Promise<{
    items: AuditLogRecord[];
    total: number;
  }>;
}
