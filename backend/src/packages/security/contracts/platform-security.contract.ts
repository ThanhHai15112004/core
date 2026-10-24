import type { UserIdentity } from './auth.contract.js';

/**
 * Mục 4.5.1 — Cấu hình HTTP Security Headers chuẩn bảo mật nền tảng:
 * - Strict-Transport-Security (HSTS)
 * - X-Frame-Options (Chống Clickjacking)
 * - X-Content-Type-Options (Chống MIME-sniffing)
 * - Referrer-Policy
 * - Permissions-Policy
 * - X-Permitted-Cross-Domain-Policies
 * - Cross-Origin-Opener-Policy
 * - Content-Security-Policy
 */
export interface SecurityHeadersOptions {
  readonly hstsMaxAgeSeconds?: number | undefined;
  readonly hstsIncludeSubDomains?: boolean | undefined;
  readonly hstsPreload?: boolean | undefined;
  readonly frameOptions?: 'DENY' | 'SAMEORIGIN' | undefined;
  readonly contentTypeOptions?: 'nosniff' | undefined;
  readonly referrerPolicy?: string | undefined;
  readonly permissionsPolicy?: string | undefined;
  readonly crossOriginOpenerPolicy?: string | undefined;
  readonly contentSecurityPolicy?: string | undefined;
}

export const DEFAULT_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'x-permitted-cross-domain-policies': 'none',
  'cross-origin-opener-policy': 'same-origin',
  'x-xss-protection': '0',
};

/**
 * Mục 4.5.2 — Danh sách Origin mặc định được phép gọi CORS (không mở wildcard '*' tùy tiện)
 */
export const DEFAULT_CORS_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176',
];

export interface CorsEvaluationResult {
  readonly allowed: boolean;
  readonly allowedOrigin: string | null;
}

/**
 * Mục 4.5.3 — Cấu hình & kết quả kiểm tra Rate Limit theo 3 chiều (IP, Người dùng, Tuyến API)
 */
export interface RateLimitRuleConfig {
  readonly routePattern: string;
  readonly windowSeconds: number;
  readonly maxRequestsPerIp: number;
  readonly maxRequestsPerUser: number;
  readonly maxRequestsPerApi: number;
}

export interface RateLimitCheckInput {
  readonly ipAddress?: string | null | undefined;
  readonly ip?: string | null | undefined;
  readonly userId?: number | string | null | undefined;
  readonly method?: string | null | undefined;
  readonly url?: string | null | undefined;
  readonly routeKey?: string | null | undefined;
}

export interface RateLimitCheckResult {
  readonly allowed: boolean;
  readonly violatedDimension?: 'IP' | 'USER' | 'API' | undefined;
  readonly exceededDimension?: 'IP' | 'USER' | 'API' | undefined;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAtMs: number;
  readonly retryAfterSeconds: number;
  readonly routeKey: string;
}

/**
 * Mục 4.5.7 — Mã phân loại Sự kiện bảo mật (Security Events):
 * - 1 = LOGIN_SUCCESS (Đăng nhập thành công)
 * - 2 = LOGIN_FAILED (Đăng nhập sai mật khẩu / MFA sai / tài khoản bị khóa)
 * - 3 = LOGOUT (Đăng xuất phiên)
 * - 4 = LOGOUT_ALL (Đăng xuất toàn bộ thiết bị / thu hồi toàn bộ phiên)
 * - 5 = PERMISSION_CHANGED (Đổi quyền vai trò hoặc gán lại vai trò cho người dùng)
 * - 6 = MFA_DISABLED (Người dùng tắt MFA hoặc Admin reset MFA)
 * - 7 = DATA_EXPORT (Xuất dữ liệu / Xuất dữ liệu lớn)
 * - 8 = RATE_LIMIT_EXCEEDED (Vượt giới hạn tần suất gọi API)
 * - 9 = TOKEN_REUSE_DETECTED (Phát hiện dùng lại Refresh Token đã xoay vòng)
 * - 10 = PASSWORD_CHANGED (Đổi hoặc đặt lại mật khẩu)
 */
export const SECURITY_EVENT_TYPE = {
  LOGIN_SUCCESS: 1,
  LOGIN_FAILED: 2,
  LOGOUT: 3,
  LOGOUT_ALL: 4,
  PERMISSION_CHANGED: 5,
  MFA_DISABLED: 6,
  DATA_EXPORT: 7,
  RATE_LIMIT_EXCEEDED: 8,
  TOKEN_REUSE_DETECTED: 9,
  PASSWORD_CHANGED: 10,
} as const;

export type SecurityEventTypeCode = (typeof SECURITY_EVENT_TYPE)[keyof typeof SECURITY_EVENT_TYPE];
export type SecurityEventTypeName = keyof typeof SECURITY_EVENT_TYPE;

export function getSecurityEventTypeName(code: number): SecurityEventTypeName {
  switch (Number(code)) {
    case SECURITY_EVENT_TYPE.LOGIN_FAILED:
      return 'LOGIN_FAILED';
    case SECURITY_EVENT_TYPE.LOGOUT:
      return 'LOGOUT';
    case SECURITY_EVENT_TYPE.LOGOUT_ALL:
      return 'LOGOUT_ALL';
    case SECURITY_EVENT_TYPE.PERMISSION_CHANGED:
      return 'PERMISSION_CHANGED';
    case SECURITY_EVENT_TYPE.MFA_DISABLED:
      return 'MFA_DISABLED';
    case SECURITY_EVENT_TYPE.DATA_EXPORT:
      return 'DATA_EXPORT';
    case SECURITY_EVENT_TYPE.RATE_LIMIT_EXCEEDED:
      return 'RATE_LIMIT_EXCEEDED';
    case SECURITY_EVENT_TYPE.TOKEN_REUSE_DETECTED:
      return 'TOKEN_REUSE_DETECTED';
    case SECURITY_EVENT_TYPE.PASSWORD_CHANGED:
      return 'PASSWORD_CHANGED';
    case SECURITY_EVENT_TYPE.LOGIN_SUCCESS:
    default:
      return 'LOGIN_SUCCESS';
  }
}

export function parseSecurityEventTypeCode(input: number | string): SecurityEventTypeCode {
  if (typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 10) {
    return input as SecurityEventTypeCode;
  }
  const normalized = String(input).trim().toUpperCase();
  switch (normalized) {
    case 'LOGIN_FAILED':
    case 'MFA_FAILED':
    case '2':
      return SECURITY_EVENT_TYPE.LOGIN_FAILED;
    case 'LOGOUT':
    case 'SESSION_REVOKED':
    case '3':
      return SECURITY_EVENT_TYPE.LOGOUT;
    case 'LOGOUT_ALL':
    case 'SESSION_REVOKE_ALL':
    case '4':
      return SECURITY_EVENT_TYPE.LOGOUT_ALL;
    case 'PERMISSION_CHANGED':
    case 'ROLE_PERMISSION_CHANGED':
    case '5':
      return SECURITY_EVENT_TYPE.PERMISSION_CHANGED;
    case 'MFA_DISABLED':
    case 'MFA_RESET':
    case '6':
      return SECURITY_EVENT_TYPE.MFA_DISABLED;
    case 'DATA_EXPORT':
    case 'LARGE_DATA_EXPORT':
    case '7':
      return SECURITY_EVENT_TYPE.DATA_EXPORT;
    case 'RATE_LIMIT_EXCEEDED':
    case '8':
      return SECURITY_EVENT_TYPE.RATE_LIMIT_EXCEEDED;
    case 'TOKEN_REUSE_DETECTED':
    case '9':
      return SECURITY_EVENT_TYPE.TOKEN_REUSE_DETECTED;
    case 'PASSWORD_CHANGED':
    case 'PASSWORD_RESET':
    case '10':
      return SECURITY_EVENT_TYPE.PASSWORD_CHANGED;
    case 'LOGIN_SUCCESS':
    case '1':
    default:
      return SECURITY_EVENT_TYPE.LOGIN_SUCCESS;
  }
}

/** Mức độ nghiêm trọng của sự kiện & cảnh báo bảo mật (Mục 4.5.7 & 4.5.8) */
export const SECURITY_ALERT_SEVERITY = {
  INFO: 1,
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  CRITICAL: 5,
} as const;

export type SecurityAlertSeverityCode =
  (typeof SECURITY_ALERT_SEVERITY)[keyof typeof SECURITY_ALERT_SEVERITY];
export type SecurityAlertSeverityName = keyof typeof SECURITY_ALERT_SEVERITY;
export type SecurityEventSeverity = SecurityAlertSeverityName | 'WARNING';

export function getSecurityAlertSeverityName(code: number): SecurityAlertSeverityName {
  switch (Number(code)) {
    case SECURITY_ALERT_SEVERITY.LOW:
      return 'LOW';
    case SECURITY_ALERT_SEVERITY.MEDIUM:
      return 'MEDIUM';
    case SECURITY_ALERT_SEVERITY.HIGH:
      return 'HIGH';
    case SECURITY_ALERT_SEVERITY.CRITICAL:
      return 'CRITICAL';
    case SECURITY_ALERT_SEVERITY.INFO:
    default:
      return 'INFO';
  }
}

export interface RecordSecurityEventInput {
  readonly eventType: SecurityEventTypeCode | SecurityEventTypeName | string;
  readonly severity?: SecurityAlertSeverityCode | SecurityEventSeverity | undefined;
  readonly actor?: UserIdentity | null | undefined;
  readonly actorUserId?: number | null | undefined;
  readonly actorId?: number | null | undefined;
  readonly targetUserId?: number | null | undefined;
  readonly identifier?: string | null | undefined;
  readonly module?: string | undefined;
  readonly feature?: string | undefined;
  readonly action?: string | undefined;
  readonly resourceType?: string | null | undefined;
  readonly resourceId?: string | number | null | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly reason?: string | null | undefined;
  readonly exportedRowCount?: number | undefined;
  readonly recordCount?: number | undefined;
  readonly beforeData?: unknown;
  readonly afterData?: unknown;
  readonly metadata?: Record<string, unknown> | undefined;
  /** Nếu đặt true (hoặc persistToAuditLog = false), chỉ ghi nhận Security Event + SIEM Alert mà không ghi lặp vào AuditLogService */
  readonly skipAuditLog?: boolean | undefined;
  readonly persistToAuditLog?: boolean | undefined;
}

export interface SecurityEventRecord {
  readonly id: number;
  readonly eventType: SecurityEventTypeName;
  readonly eventTypeCode: SecurityEventTypeCode;
  readonly eventTypeName: SecurityEventTypeName;
  readonly severity: SecurityAlertSeverityName;
  readonly severityCode: SecurityAlertSeverityCode;
  readonly severityName: SecurityAlertSeverityName;
  readonly actorId: number | null;
  readonly actorUserId: number | null;
  readonly targetUserId: number | null;
  readonly identifier: string | null;
  readonly module: string;
  readonly action: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly reason: string | null;
  readonly exportedRowCount: number | null;
  readonly recordCount: number | null;
  readonly metadata: Record<string, unknown> | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

/**
 * Mục 4.5.8 — Bản ghi Cảnh báo thao tác bất thường (Security Anomaly Alert) gửi sang Monitoring / SIEM
 */
export interface SecurityAnomalyAlert {
  readonly id: number;
  readonly anomalyType: string;
  readonly alertCode: string;
  readonly eventType: SecurityEventTypeName;
  readonly eventTypeCode: SecurityEventTypeCode;
  readonly eventTypeName: SecurityEventTypeName;
  readonly severity: SecurityAlertSeverityName;
  readonly severityCode: SecurityAlertSeverityCode;
  readonly severityName: SecurityAlertSeverityName;
  readonly title: string;
  readonly description: string;
  readonly actorId: number | null;
  readonly actorUserId: number | null;
  readonly targetUserId: number | null;
  readonly ipAddress: string | null;
  readonly module: string;
  readonly metadata: Record<string, unknown>;
  readonly dispatchedToSiem: boolean;
  readonly siemDestinations: readonly string[];
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

/**
 * Cổng tích hợp gửi cảnh báo thao tác bất thường sang hệ thống Monitoring / SIEM bên ngoài
 * (ví dụ: Elastic SIEM, SplunkHEC, Datadog, PagerDuty, Webhook).
 */
export interface ISiemAlertSink {
  readonly name: string;
  sendAlert(alert: SecurityAnomalyAlert): Promise<void> | void;
}
