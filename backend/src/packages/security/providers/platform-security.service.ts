import { Injectable, Logger, Optional } from '@nestjs/common';
import { HTTP_ERROR_CODE, TooManyRequestsAppException } from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { AuditLogService } from './audit-log.service.js';
import {
  type CorsEvaluationResult,
  DEFAULT_CORS_ALLOWED_ORIGINS,
  DEFAULT_SECURITY_HEADERS,
  type ISiemAlertSink,
  type RateLimitCheckInput,
  type RateLimitCheckResult,
  type RateLimitRuleConfig,
  type RecordSecurityEventInput,
  SECURITY_ALERT_SEVERITY,
  type SecurityAlertSeverityCode,
  SECURITY_EVENT_TYPE,
  type SecurityAnomalyAlert,
  type SecurityEventRecord,
  type SecurityEventSeverity,
  type SecurityEventTypeCode,
  type SecurityHeadersOptions,
  getSecurityAlertSeverityName,
  getSecurityEventTypeName,
  parseSecurityEventTypeCode,
} from '../contracts/platform-security.contract.js';

interface RateLimitBucket {
  count: number;
  resetAtMs: number;
}

const PASSWORD_PRESERVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'oldpassword',
  'clientsecret',
  'secret',
  'csvcontent',
  'xlsxbase64',
  'logobase64',
]);

const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Các trường nội bộ cực kỳ nhạy cảm tuyệt đối không bao giờ được xuất hiện trong API Response DTO (Mục 4.5.6)
 */
const INTERNAL_RESPONSE_REDACT_KEYS = new Set([
  'passwordhash',
  'password_hash',
  'passwordhistoryhashes',
  'passwordhistoryhashesjson',
  'password_history_hashes_json',
  'totpsecret',
  'totp_secret',
  'clientsecrethash',
  'client_secret_hash',
  'recoverycodeshashjson',
  'recovery_codes_hash_json',
  'emailotpcodehash',
  'email_otp_code_hash',
  'smsotpcodehash',
  'sms_otp_code_hash',
  'otpcodehash',
  'otp_code_hash',
  'codehash',
  'code_hash',
  'refreshtokenhash',
  'refresh_token_hash',
  'tokenhash',
  'token_hash',
]);

/**
 * Làm sạch sâu chuỗi đầu vào để giảm rủi ro XSS / Script Injection / Null-byte Injection (Mục 4.5.4)
 */
export function sanitizeStringInput(raw: string): string {
  if (!raw) return raw;
  return (
    raw
      // Loại bỏ ký tự null-byte (\0) và các ký tự điều khiển ẩn nguy hiểm (giữ lại \t, \n, \r)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      // Loại bỏ cặp thẻ <script>...</script>
      .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      // Loại bỏ thẻ mở/đóng <script>, <iframe>, <object>, <embed> rời rạc
      .replace(/<\s*\/?\s*(?:script|iframe|object|embed)\b[^>]*>/gi, '')
      // Loại bỏ giao thức javascript: hoặc vbscript:
      .replace(/\b(?:javascript|vbscript)\s*:/gi, '')
      // Loại bỏ inline event handlers (onerror=, onload=, onclick=...)
      .replace(/\bon[a-z]{2,20}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  );
}

/**
 * Làm sạch đệ quy toàn bộ dữ liệu đầu vào (`body`, `query`, `params`) trước khi xử lý (Mục 4.5.4):
 * - Chặn Prototype Pollution (`__proto__`, `constructor`, `prototype`)
 * - Làm sạch chuỗi chống XSS / Null-byte / Control characters
 */
export function sanitizeInputPayload<T>(input: T, currentKey?: string, depth = 0): T {
  if (input === null || input === undefined || depth > 12) {
    return input;
  }

  if (typeof input === 'string') {
    const normalizedKey = (currentKey ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (PASSWORD_PRESERVE_KEYS.has(normalizedKey)) {
      // Với mật khẩu hoặc base64 file, chỉ loại bỏ null-byte (\0) để giữ nguyên ký tự đặc biệt hợp lệ
      return input.replaceAll('\0', '') as unknown as T;
    }
    return sanitizeStringInput(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeInputPayload(item, currentKey, depth + 1)) as unknown as T;
  }

  if (typeof input === 'object' && !(input instanceof Date) && !Buffer.isBuffer(input)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (FORBIDDEN_PROTOTYPE_KEYS.has(key.trim().toLowerCase())) {
        continue;
      }
      cleaned[key] = sanitizeInputPayload(val, key, depth + 1);
    }
    return cleaned as unknown as T;
  }

  return input;
}

/**
 * Che giấu tự động các trường mật khẩu băm / khóa bí mật nội bộ nếu vô tình lọt vào Response DTO (Mục 4.5.6)
 */
export function redactSensitiveResponseData<T>(payload: T, depth = 0): T {
  if (payload === null || payload === undefined || depth > 10) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactSensitiveResponseData(item, depth + 1)) as unknown as T;
  }

  if (typeof payload === 'object' && !(payload instanceof Date) && !Buffer.isBuffer(payload)) {
    const record = payload as Record<string, unknown>;
    let mutated = false;
    const clone: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = key.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (INTERNAL_RESPONSE_REDACT_KEYS.has(normalizedKey)) {
        clone[key] = '[REDACTED]';
        mutated = true;
      } else if (typeof value === 'object' && value !== null) {
        const nextVal = redactSensitiveResponseData(value, depth + 1);
        if (nextVal !== value) {
          mutated = true;
        }
        clone[key] = nextVal;
      } else {
        clone[key] = value;
      }
    }

    return (mutated ? clone : payload) as T;
  }

  return payload;
}

@Injectable()
export class PlatformSecurityService {
  private readonly logger = new Logger(PlatformSecurityService.name);
  private readonly auditLogService?: AuditLogService;
  private securityHeaders: Record<string, string> = { ...DEFAULT_SECURITY_HEADERS };
  private allowedOrigins = new Set<string>(DEFAULT_CORS_ALLOWED_ORIGINS);
  private allowCredentials = true;

  private defaultRateLimitRule: RateLimitRuleConfig = {
    routePattern: '*',
    windowSeconds: 60,
    maxRequestsPerIp: 600,
    maxRequestsPerUser: 600,
    maxRequestsPerApi: 1200,
  };
  private readonly customRateLimitRules = new Map<string, RateLimitRuleConfig>();
  private readonly ipBuckets = new Map<string, RateLimitBucket>();
  private readonly userBuckets = new Map<string, RateLimitBucket>();
  private readonly apiBuckets = new Map<string, RateLimitBucket>();

  private eventSeq = 0;
  private alertSeq = 0;
  private readonly securityEvents: SecurityEventRecord[] = [];
  private readonly anomalyAlerts: SecurityAnomalyAlert[] = [];
  private readonly siemSinks: ISiemAlertSink[] = [];

  private readonly failedLoginCounterByTarget = new Map<
    string,
    { count: number; firstAtMs: number }
  >();
  private failedLoginAlertThreshold = 3;
  private largeExportRowThreshold = 50;

  constructor(
    @Optional() auditLogOrConfig?: AuditLogService | unknown,
    @Optional() maybeAuditLog?: AuditLogService,
  ) {
    if (maybeAuditLog && typeof (maybeAuditLog as { record?: unknown }).record === 'function') {
      this.auditLogService = maybeAuditLog;
    } else if (
      auditLogOrConfig &&
      typeof (auditLogOrConfig as { record?: unknown }).record === 'function'
    ) {
      this.auditLogService = auditLogOrConfig as AuditLogService;
    }

    const rawEnvOrigins = process.env.CORS_ALLOWED_ORIGINS;
    if (rawEnvOrigins && rawEnvOrigins.trim().length > 0) {
      const parsed = rawEnvOrigins
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0 && o !== '*');
      if (parsed.length > 0) {
        this.allowedOrigins = new Set(parsed);
      }
    }
  }

  // =========================================================================
  // 1. SECURITY HEADERS (Mục 4.5.1)
  // =========================================================================

  /** Lấy bộ HTTP Security Headers chuẩn (HSTS, X-Frame-Options, X-Content-Type-Options...) */
  public getSecurityHeaders(): Readonly<Record<string, string>> {
    return { ...this.securityHeaders };
  }

  /** Cập nhật cấu hình HTTP Security Headers */
  public configureSecurityHeaders(
    options: SecurityHeadersOptions,
  ): Readonly<Record<string, string>> {
    const next: Record<string, string> = { ...this.securityHeaders };
    if (options.hstsMaxAgeSeconds !== undefined) {
      const sub = options.hstsIncludeSubDomains !== false ? '; includeSubDomains' : '';
      const preload = options.hstsPreload !== false ? '; preload' : '';
      next['strict-transport-security'] =
        `max-age=${Math.max(0, options.hstsMaxAgeSeconds)}${sub}${preload}`;
    }
    if (options.frameOptions) {
      next['x-frame-options'] = options.frameOptions;
    }
    if (options.contentTypeOptions) {
      next['x-content-type-options'] = options.contentTypeOptions;
    }
    if (options.referrerPolicy) {
      next['referrer-policy'] = options.referrerPolicy;
    }
    if (options.permissionsPolicy) {
      next['permissions-policy'] = options.permissionsPolicy;
    }
    if (options.crossOriginOpenerPolicy) {
      next['cross-origin-opener-policy'] = options.crossOriginOpenerPolicy;
    }
    if (options.contentSecurityPolicy) {
      next['content-security-policy'] = options.contentSecurityPolicy;
    }
    this.securityHeaders = next;
    return this.getSecurityHeaders();
  }

  // =========================================================================
  // 2. CORS DOMAIN ALLOWLIST (Mục 4.5.2)
  // =========================================================================

  /** Lấy danh sách domain được phép gọi CORS */
  public getAllowedOrigins(): string[] {
    return [...this.allowedOrigins];
  }

  /** Thiết lập danh sách domain được phép gọi CORS (tự động loại bỏ wildcard '*' tùy tiện) */
  public setAllowedOrigins(origins: readonly string[], allowCredentials = true): string[] {
    const sanitized = origins
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter((o) => o.length > 0 && o !== '*');
    this.allowedOrigins = new Set(sanitized);
    this.allowCredentials = allowCredentials;
    return this.getAllowedOrigins();
  }

  /** Kiểm tra Origin của request có nằm trong danh sách domain được phép hay không (Mục 4.5.2) */
  public evaluateCorsOrigin(originHeader?: string | null): CorsEvaluationResult {
    // Request cùng origin (same-origin) hoặc server-to-server không gửi header Origin -> cho phép, không gắn wildcard
    if (!originHeader || originHeader.trim().length === 0) {
      return {
        allowed: true,
        allowedOrigin: null,
      };
    }

    const normalized = originHeader.trim().replace(/\/+$/, '');
    if (normalized === '*') {
      return {
        allowed: false,
        allowedOrigin: null,
      };
    }

    if (this.allowedOrigins.has(normalized)) {
      return {
        allowed: true,
        allowedOrigin: normalized,
      };
    }

    // Hỗ trợ mẫu subdomain được phép có kiểm soát (ví dụ: '*.trusted.enterprise.vn')
    const hostMatch = /^https?:\/\/([^/:?#]+)/i.exec(normalized);
    const hostname = hostMatch?.[1]?.toLowerCase() ?? '';
    if (hostname) {
      for (const pattern of this.allowedOrigins) {
        const cleanedPattern = pattern.replace(/^https?:\/\//i, '').toLowerCase();
        if (cleanedPattern.startsWith('*.')) {
          const suffix = cleanedPattern.slice(1); // '.trusted.enterprise.vn'
          if (hostname.endsWith(suffix) && hostname.length > suffix.length) {
            return {
              allowed: true,
              allowedOrigin: normalized,
            };
          }
        }
      }
    }

    return {
      allowed: false,
      allowedOrigin: null,
    };
  }

  // =========================================================================
  // 3. RATE LIMIT THEO IP, NGƯỜI DÙNG VÀ API (Mục 4.5.3)
  // =========================================================================

  /** Cấu hình ngưỡng Rate Limit mặc định toàn hệ thống */
  public setDefaultRateLimitRule(rule: Partial<RateLimitRuleConfig>): RateLimitRuleConfig {
    this.defaultRateLimitRule = {
      ...this.defaultRateLimitRule,
      ...rule,
      routePattern: '*',
    };
    return { ...this.defaultRateLimitRule };
  }

  /** Đăng ký ngưỡng Rate Limit riêng cho một tuyến API cụ thể (vd: 'POST /api/v1/auth/login') */
  public setRouteRateLimitRule(rule: RateLimitRuleConfig): void {
    const normalizedPattern = this.normalizeRoutePattern(rule.routePattern);
    this.customRateLimitRules.set(normalizedPattern, {
      ...rule,
      routePattern: normalizedPattern,
    });
  }

  /** Alias tiện lợi cấu hình Rate Limit cho một tuyến API (theo ipLimit, userLimit, apiLimit, windowSeconds) */
  public setRateLimitRule(
    routePattern: string,
    options: {
      ipLimit?: number | undefined;
      userLimit?: number | undefined;
      apiLimit?: number | undefined;
      maxRequestsPerIp?: number | undefined;
      maxRequestsPerUser?: number | undefined;
      maxRequestsPerApi?: number | undefined;
      windowSeconds?: number | undefined;
    },
  ): void {
    this.setRouteRateLimitRule({
      routePattern,
      windowSeconds: options.windowSeconds ?? 60,
      maxRequestsPerIp: options.ipLimit ?? options.maxRequestsPerIp ?? 600,
      maxRequestsPerUser: options.userLimit ?? options.maxRequestsPerUser ?? 600,
      maxRequestsPerApi: options.apiLimit ?? options.maxRequestsPerApi ?? 1200,
    });
  }

  /** Xóa cấu hình Rate Limit tùy chỉnh và đặt lại toàn bộ bộ đếm */
  public resetRateLimits(clearCustomRules = false): void {
    this.ipBuckets.clear();
    this.userBuckets.clear();
    this.apiBuckets.clear();
    if (clearCustomRules) {
      this.customRateLimitRules.clear();
    }
  }

  /** Alias tiêu thụ & kiểm tra Rate Limit theo 3 chiều (IP, User, API Route) */
  public consumeRateLimit(input: RateLimitCheckInput): RateLimitCheckResult {
    return this.checkRateLimit(input);
  }

  /** Kiểm tra tần suất gọi API theo đồng thời 3 chiều: IP, User ID và Route API (Mục 4.5.3) */
  public checkRateLimit(input: RateLimitCheckInput): RateLimitCheckResult {
    let method = (input.method ?? 'GET').trim().toUpperCase();
    let rawPath = (input.url ?? '/').split('?')[0]?.trim() || '/';
    if (input.routeKey && input.routeKey.trim().length > 0) {
      const parts = input.routeKey.trim().split(/\s+/);
      if (parts.length >= 2) {
        method = parts[0]!.toUpperCase();
        rawPath = parts.slice(1).join(' ').split('?')[0]?.trim() || '/';
      } else {
        rawPath = parts[0]!.split('?')[0]?.trim() || '/';
      }
    }
    const routeKey = `${method} ${rawPath}`;
    const rule = this.resolveRateLimitRule(method, rawPath);
    const windowMs = Math.max(1, rule.windowSeconds) * 1000;
    const nowMs = Date.now();
    const resolvedIp = (input.ipAddress ?? input.ip ?? '127.0.0.1').trim();

    const ipKey = `${rule.routePattern}:ip:${resolvedIp}`;
    const ipBucket = this.incrementBucket(this.ipBuckets, ipKey, windowMs, nowMs);
    if (ipBucket.count > rule.maxRequestsPerIp) {
      return this.buildRateLimitResult(
        false,
        'IP',
        rule.maxRequestsPerIp,
        0,
        ipBucket.resetAtMs,
        nowMs,
        routeKey,
      );
    }

    if (input.userId !== undefined && input.userId !== null && String(input.userId).trim() !== '') {
      const userKey = `${rule.routePattern}:user:${String(input.userId).trim()}`;
      const userBucket = this.incrementBucket(this.userBuckets, userKey, windowMs, nowMs);
      if (userBucket.count > rule.maxRequestsPerUser) {
        return this.buildRateLimitResult(
          false,
          'USER',
          rule.maxRequestsPerUser,
          0,
          userBucket.resetAtMs,
          nowMs,
          routeKey,
        );
      }
    }

    const apiKey = `${rule.routePattern}:api:${routeKey}`;
    const apiBucket = this.incrementBucket(this.apiBuckets, apiKey, windowMs, nowMs);
    if (apiBucket.count > rule.maxRequestsPerApi) {
      return this.buildRateLimitResult(
        false,
        'API',
        rule.maxRequestsPerApi,
        0,
        apiBucket.resetAtMs,
        nowMs,
        routeKey,
      );
    }

    const effectiveLimit = rule.maxRequestsPerIp;
    const effectiveRemaining = Math.max(0, effectiveLimit - ipBucket.count);
    return this.buildRateLimitResult(
      true,
      undefined,
      effectiveLimit,
      effectiveRemaining,
      ipBucket.resetAtMs,
      nowMs,
      routeKey,
    );
  }

  /** Kiểm tra Rate Limit và ném ngoại lệ 429 Too Many Requests nếu vượt ngưỡng */
  public async assertRateLimit(input: RateLimitCheckInput): Promise<RateLimitCheckResult> {
    const result = this.checkRateLimit(input);
    if (!result.allowed) {
      await this.recordSecurityEvent({
        eventType: SECURITY_EVENT_TYPE.RATE_LIMIT_EXCEEDED,
        severity: SECURITY_ALERT_SEVERITY.MEDIUM,
        actorUserId:
          input.userId !== undefined && input.userId !== null && !Number.isNaN(Number(input.userId))
            ? Number(input.userId)
            : null,
        ipAddress: input.ipAddress ?? input.ip ?? null,
        module: 'security',
        feature: 'rate_limit',
        action: 'RATE_LIMIT_EXCEEDED',
        reason: `Rate limit exceeded on dimension ${result.violatedDimension} for ${result.routeKey}`,
        metadata: {
          violatedDimension: result.violatedDimension,
          routeKey: result.routeKey,
          limit: result.limit,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      });

      throw new TooManyRequestsAppException(
        HTTP_ERROR_CODE.TOO_MANY_REQUESTS,
        [
          {
            dimension: result.violatedDimension,
            route: result.routeKey,
            limit: result.limit,
            retryAfterSeconds: result.retryAfterSeconds,
          },
        ],
        { retryAfterSeconds: result.retryAfterSeconds },
      );
    }
    return result;
  }

  // =========================================================================
  // 4. SỰ KIỆN BẢO MẬT & CẢNH BÁO THAO TÁC BẤT THƯỜNG / SIEM (Mục 4.5.7 & 4.5.8)
  // =========================================================================

  /** Cấu hình ngưỡng phát cảnh báo đăng nhập sai liên tiếp và ngưỡng xuất dữ liệu lớn */
  public configureAnomalyThresholds(options: {
    failedLoginAlertThreshold?: number | undefined;
    largeExportRowThreshold?: number | undefined;
  }): void {
    if (options.failedLoginAlertThreshold !== undefined && options.failedLoginAlertThreshold >= 1) {
      this.failedLoginAlertThreshold = options.failedLoginAlertThreshold;
    }
    if (options.largeExportRowThreshold !== undefined && options.largeExportRowThreshold >= 1) {
      this.largeExportRowThreshold = options.largeExportRowThreshold;
    }
  }

  /** Cập nhật ngưỡng số bản ghi xuất dữ liệu lớn để phát cảnh báo SIEM */
  public setLargeExportThreshold(rows: number): void {
    this.configureAnomalyThresholds({ largeExportRowThreshold: rows });
  }

  /** Đăng ký cổng nhận cảnh báo Monitoring / SIEM (Mục 4.5.8) */
  public registerSiemSink(sink: ISiemAlertSink): void {
    const existingIdx = this.siemSinks.findIndex((s) => s.name === sink.name);
    if (existingIdx >= 0) {
      this.siemSinks[existingIdx] = sink;
    } else {
      this.siemSinks.push(sink);
    }
  }

  /** Alias đăng ký cổng nhận cảnh báo SIEM */
  public registerSiemAlertSink(sink: ISiemAlertSink): void {
    this.registerSiemSink(sink);
  }

  /** Gỡ cổng nhận cảnh báo SIEM theo tên */
  public unregisterSiemSink(name: string): boolean {
    const idx = this.siemSinks.findIndex((s) => s.name === name);
    if (idx === -1) return false;
    this.siemSinks.splice(idx, 1);
    return true;
  }

  /**
   * Ghi nhận sự kiện bảo mật (Login, Login sai, Logout, Đổi quyền, Tắt MFA, Export dữ liệu lớn)
   * và tự động đánh giá phát cảnh báo bất thường sang Monitoring / SIEM (Mục 4.5.7 & 4.5.8).
   */
  public async recordSecurityEvent(input: RecordSecurityEventInput): Promise<{
    event: SecurityEventRecord;
    alert: SecurityAnomalyAlert | null;
  }> {
    const ctx = RequestContextService.current();
    const requestId = ctx?.requestId ?? ctx?.correlationId ?? null;
    const correlationId = ctx?.correlationId ?? null;
    const ipAddress = input.ipAddress ?? ctx?.ipAddress ?? '127.0.0.1';
    const userAgent = input.userAgent ?? ctx?.userAgent ?? null;
    const actorUserId =
      input.actorUserId ??
      input.actorId ??
      input.actor?.id ??
      (ctx?.userId && !Number.isNaN(Number(ctx.userId)) ? Number(ctx.userId) : null);

    const eventTypeCode = parseSecurityEventTypeCode(input.eventType);
    const eventTypeName = getSecurityEventTypeName(eventTypeCode);
    const exportedCount = input.exportedRowCount ?? input.recordCount ?? null;

    const severityCode: SecurityAlertSeverityCode =
      typeof input.severity === 'number'
        ? input.severity
        : this.inferDefaultSeverity(eventTypeCode, exportedCount ?? undefined);
    const severityName = getSecurityAlertSeverityName(severityCode);
    const moduleName = (input.module ?? 'security').trim().toLowerCase();
    const featureName = (input.feature ?? 'security_events').trim().toLowerCase();
    const actionName = (input.action ?? eventTypeName).trim().toUpperCase();

    const eventRecord: SecurityEventRecord = {
      id: ++this.eventSeq,
      eventType: eventTypeName,
      eventTypeCode,
      eventTypeName,
      severity: severityName,
      severityCode,
      severityName,
      actorId: actorUserId,
      actorUserId,
      targetUserId: input.targetUserId ?? null,
      identifier: input.identifier ?? input.actor?.email ?? input.actor?.username ?? null,
      module: moduleName,
      action: actionName,
      ipAddress,
      userAgent,
      reason: input.reason ?? null,
      exportedRowCount: exportedCount,
      recordCount: exportedCount,
      metadata: input.metadata ? { ...input.metadata } : null,
      requestId,
      correlationId,
      createdAt: new Date().toISOString(),
    };

    this.securityEvents.unshift(eventRecord);
    if (this.securityEvents.length > 1000) {
      this.securityEvents.pop();
    }

    const shouldSkipAudit = input.skipAuditLog === true || input.persistToAuditLog === false;

    // Đồng bộ vào AuditLogService nếu chưa được nơi gọi ghi trực tiếp
    if (!shouldSkipAudit && this.auditLogService) {
      await this.auditLogService.record({
        actor: input.actor,
        actorUserId,
        actorIdentifier: eventRecord.identifier,
        module: moduleName,
        feature: featureName,
        action: actionName,
        resourceType: input.resourceType ?? 'security_event',
        resourceId: input.resourceId ?? input.targetUserId ?? actorUserId ?? eventRecord.id,
        beforeData: input.beforeData ?? null,
        afterData:
          input.afterData ??
          (input.metadata || exportedCount !== null
            ? {
                ...(input.metadata ?? {}),
                ...(exportedCount !== null ? { exportedRowCount: exportedCount } : {}),
              }
            : null),
        reason: input.reason ?? null,
        ipAddress,
        userAgent,
        requestId,
        correlationId,
      });
    }

    const alert = await this.evaluateAndDispatchAnomalyAlert(eventRecord, input);
    return { event: eventRecord, alert };
  }

  /** Liệt kê danh sách các sự kiện bảo mật gần nhất (hỗ trợ lọc theo loại sự kiện, module, userId) */
  public listSecurityEvents(filter?: {
    eventType?: SecurityEventTypeCode | string | undefined;
    actorId?: number | undefined;
    actorUserId?: number | undefined;
    targetUserId?: number | undefined;
    module?: string | undefined;
    limit?: number | undefined;
  }): SecurityEventRecord[] {
    let items = [...this.securityEvents];
    if (filter?.eventType !== undefined) {
      const targetCode = parseSecurityEventTypeCode(filter.eventType);
      items = items.filter((e) => e.eventTypeCode === targetCode);
    }
    const actorFilter = filter?.actorUserId ?? filter?.actorId;
    if (actorFilter !== undefined) {
      items = items.filter(
        (e) => e.actorUserId === Number(actorFilter) || e.targetUserId === Number(actorFilter),
      );
    }
    if (filter?.targetUserId !== undefined) {
      items = items.filter((e) => e.targetUserId === Number(filter.targetUserId));
    }
    if (filter?.module?.trim()) {
      const m = filter.module.trim().toLowerCase();
      items = items.filter((e) => e.module === m);
    }
    const limit = Math.max(1, Math.min(200, filter?.limit ?? 50));
    return items.slice(0, limit);
  }

  /** Liệt kê danh sách các cảnh báo thao tác bất thường đã phát sinh (Mục 4.5.8) */
  public listAnomalyAlerts(filter?: {
    anomalyType?: string | undefined;
    severity?: SecurityAlertSeverityCode | SecurityEventSeverity | undefined;
    actorId?: number | undefined;
    actorUserId?: number | undefined;
    eventType?: number | string | undefined;
    limit?: number | undefined;
  }): SecurityAnomalyAlert[] {
    let items = [...this.anomalyAlerts];
    if (filter?.anomalyType?.trim()) {
      const t = filter.anomalyType.trim().toUpperCase();
      items = items.filter(
        (a) => a.anomalyType.toUpperCase() === t || a.alertCode.toUpperCase() === t,
      );
    }
    if (filter?.severity !== undefined) {
      if (typeof filter.severity === 'number') {
        items = items.filter((a) => a.severityCode >= Number(filter.severity));
      } else {
        const s = String(filter.severity).trim().toUpperCase();
        items = items.filter((a) => a.severity.toUpperCase() === s);
      }
    }
    const actorFilter = filter?.actorUserId ?? filter?.actorId;
    if (actorFilter !== undefined) {
      items = items.filter(
        (a) => a.actorUserId === Number(actorFilter) || a.targetUserId === Number(actorFilter),
      );
    }
    if (filter?.eventType !== undefined) {
      const targetCode = parseSecurityEventTypeCode(filter.eventType);
      items = items.filter((a) => a.eventTypeCode === targetCode);
    }
    const limit = Math.max(1, Math.min(200, filter?.limit ?? 50));
    return items.slice(0, limit);
  }

  private async evaluateAndDispatchAnomalyAlert(
    event: SecurityEventRecord,
    input: RecordSecurityEventInput,
  ): Promise<SecurityAnomalyAlert | null> {
    let anomalyType: string | null = null;
    let alertCode: string | null = null;
    let alertSeverity: SecurityAlertSeverityCode = event.severityCode;
    let title = '';
    let description = '';
    const extraMeta: Record<string, unknown> = { ...(input.metadata ?? {}) };

    if (event.eventTypeCode === SECURITY_EVENT_TYPE.LOGIN_SUCCESS) {
      const key = `${event.ipAddress ?? 'unknown'}:${event.identifier ?? event.actorUserId ?? 'unknown'}`;
      this.failedLoginCounterByTarget.delete(key);
      return null;
    }

    if (event.eventTypeCode === SECURITY_EVENT_TYPE.LOGIN_FAILED) {
      const key = `${event.ipAddress ?? 'unknown'}:${event.identifier ?? event.targetUserId ?? 'unknown'}`;
      const nowMs = Date.now();
      const current = this.failedLoginCounterByTarget.get(key);
      const windowValid = current && nowMs - current.firstAtMs <= 15 * 60_000;
      const nextCount = windowValid ? current.count + 1 : 1;
      this.failedLoginCounterByTarget.set(key, {
        count: nextCount,
        firstAtMs: windowValid ? current.firstAtMs : nowMs,
      });
      extraMeta['consecutiveFailedAttempts'] = nextCount;

      const isLockedReason = (event.reason ?? '').toLowerCase().includes('locked');
      if (nextCount >= this.failedLoginAlertThreshold || isLockedReason) {
        anomalyType = 'BRUTE_FORCE_LOGIN';
        alertCode = 'ANOMALY_BRUTE_FORCE_LOGIN';
        alertSeverity = isLockedReason
          ? SECURITY_ALERT_SEVERITY.CRITICAL
          : SECURITY_ALERT_SEVERITY.HIGH;
        title = 'Repeated Failed Login / Brute-Force Attempt Detected';
        description = `Detected ${nextCount} failed login attempt(s) for '${event.identifier ?? event.targetUserId ?? 'unknown'}' from IP ${event.ipAddress ?? 'unknown'}`;
      }
    } else if (event.eventTypeCode === SECURITY_EVENT_TYPE.MFA_DISABLED) {
      anomalyType = 'MFA_PROTECTION_DISABLED';
      alertCode = 'ANOMALY_MFA_DISABLED';
      alertSeverity = SECURITY_ALERT_SEVERITY.HIGH;
      title = 'Multi-Factor Authentication (MFA) Disabled or Reset';
      description = `MFA protection was disabled/reset for user #${event.targetUserId ?? event.actorUserId ?? 'unknown'} (actor #${event.actorUserId ?? 'system'})`;
    } else if (event.eventTypeCode === SECURITY_EVENT_TYPE.PERMISSION_CHANGED) {
      anomalyType = 'PRIVILEGE_ESCALATION_OR_CHANGE';
      alertCode = 'ANOMALY_PRIVILEGE_MODIFICATION';
      alertSeverity = SECURITY_ALERT_SEVERITY.HIGH;
      title = 'Role Permissions or Security Scope Modified';
      description =
        event.reason ??
        `Permissions or roles modified in module '${event.module}' (${event.action}) by actor #${event.actorUserId ?? 'system'}`;
    } else if (event.eventTypeCode === SECURITY_EVENT_TYPE.DATA_EXPORT) {
      const rowCount = event.exportedRowCount ?? 0;
      extraMeta['exportedRowCount'] = rowCount;
      extraMeta['threshold'] = this.largeExportRowThreshold;
      if (rowCount >= this.largeExportRowThreshold) {
        anomalyType = 'LARGE_DATA_EXPORT';
        alertCode = 'ANOMALY_LARGE_DATA_EXPORT';
        alertSeverity = SECURITY_ALERT_SEVERITY.HIGH;
        title = 'Large Sensitive Data Export Detected';
        description = `Actor #${event.actorUserId ?? 'unknown'} exported ${rowCount} rows in module '${event.module}' (threshold=${this.largeExportRowThreshold})`;
      }
    } else if (event.eventTypeCode === SECURITY_EVENT_TYPE.TOKEN_REUSE_DETECTED) {
      anomalyType = 'TOKEN_COMPROMISE_SUSPECTED';
      alertCode = 'ANOMALY_REFRESH_TOKEN_REUSE';
      alertSeverity = SECURITY_ALERT_SEVERITY.CRITICAL;
      title = 'Refresh Token Reuse Attack Detected';
      description = `Rotated refresh token reuse detected for user #${event.targetUserId ?? event.actorUserId ?? 'unknown'} from IP ${event.ipAddress ?? 'unknown'}`;
    } else if (event.eventTypeCode === SECURITY_EVENT_TYPE.RATE_LIMIT_EXCEEDED) {
      anomalyType = 'RATE_LIMIT_ABUSE';
      alertCode = 'ANOMALY_RATE_LIMIT_ABUSE';
      alertSeverity = SECURITY_ALERT_SEVERITY.MEDIUM;
      title = 'API Rate Limit Threshold Exceeded';
      description = event.reason ?? 'Client exceeded configured API rate limit';
    }

    if (!alertCode || !anomalyType) {
      return null;
    }

    const siemDestinations = this.siemSinks.map((s) => s.name);
    const severityName = getSecurityAlertSeverityName(alertSeverity);
    const alert: SecurityAnomalyAlert = {
      id: ++this.alertSeq,
      anomalyType,
      alertCode,
      eventType: event.eventTypeName,
      eventTypeCode: event.eventTypeCode,
      eventTypeName: event.eventTypeName,
      severity: severityName,
      severityCode: alertSeverity,
      severityName,
      title,
      description,
      actorId: event.actorUserId,
      actorUserId: event.actorUserId,
      targetUserId: event.targetUserId,
      ipAddress: event.ipAddress,
      module: event.module,
      metadata: extraMeta,
      dispatchedToSiem: true,
      siemDestinations: siemDestinations.length > 0 ? siemDestinations : ['internal-siem-logger'],
      requestId: event.requestId,
      correlationId: event.correlationId,
      createdAt: event.createdAt,
    };

    this.anomalyAlerts.unshift(alert);
    if (this.anomalyAlerts.length > 500) {
      this.anomalyAlerts.pop();
    }

    // Ghi structured log phục vụ hệ thống Monitoring / Log Collector (Loki / ELK / Datadog)
    this.logger.warn(
      `[SIEM_ALERT] code=${alert.alertCode} severity=${alert.severityName} actor=${alert.actorUserId ?? 'anonymous'} ip=${alert.ipAddress ?? 'unknown'} msg="${alert.description}"`,
    );

    // Đẩy bất đồng bộ sang các SIEM Sink / Webhook đã đăng ký
    for (const sink of this.siemSinks) {
      try {
        await sink.sendAlert(alert);
      } catch (err) {
        this.logger.error(
          `Failed to dispatch security alert ${alert.alertCode} to SIEM sink '${sink.name}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return alert;
  }

  private inferDefaultSeverity(
    eventType: number,
    exportedRowCount?: number,
  ): SecurityAlertSeverityCode {
    switch (eventType) {
      case SECURITY_EVENT_TYPE.TOKEN_REUSE_DETECTED:
        return SECURITY_ALERT_SEVERITY.CRITICAL;
      case SECURITY_EVENT_TYPE.MFA_DISABLED:
      case SECURITY_EVENT_TYPE.PERMISSION_CHANGED:
        return SECURITY_ALERT_SEVERITY.HIGH;
      case SECURITY_EVENT_TYPE.DATA_EXPORT:
        return (exportedRowCount ?? 0) >= this.largeExportRowThreshold
          ? SECURITY_ALERT_SEVERITY.HIGH
          : SECURITY_ALERT_SEVERITY.INFO;
      case SECURITY_EVENT_TYPE.LOGIN_FAILED:
      case SECURITY_EVENT_TYPE.RATE_LIMIT_EXCEEDED:
        return SECURITY_ALERT_SEVERITY.MEDIUM;
      case SECURITY_EVENT_TYPE.PASSWORD_CHANGED:
      case SECURITY_EVENT_TYPE.LOGOUT_ALL:
        return SECURITY_ALERT_SEVERITY.LOW;
      default:
        return SECURITY_ALERT_SEVERITY.INFO;
    }
  }

  private normalizeRoutePattern(pattern: string): string {
    const trimmed = pattern.trim();
    if (trimmed === '*') return '*';
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]!.toUpperCase()} ${parts.slice(1).join(' ')}`;
    }
    return trimmed;
  }

  private resolveRateLimitRule(method: string, path: string): RateLimitRuleConfig {
    const exactKey = `${method} ${path}`;
    const exactMatch = this.customRateLimitRules.get(exactKey);
    if (exactMatch) return exactMatch;

    const pathOnlyMatch = this.customRateLimitRules.get(path);
    if (pathOnlyMatch) return pathOnlyMatch;

    for (const [pattern, rule] of this.customRateLimitRules.entries()) {
      if (pattern !== '*' && (exactKey.startsWith(pattern) || path.startsWith(pattern))) {
        return rule;
      }
    }

    return this.defaultRateLimitRule;
  }

  private incrementBucket(
    store: Map<string, RateLimitBucket>,
    key: string,
    windowMs: number,
    nowMs: number,
  ): RateLimitBucket {
    const existing = store.get(key);
    if (!existing || existing.resetAtMs <= nowMs) {
      const fresh: RateLimitBucket = {
        count: 1,
        resetAtMs: nowMs + windowMs,
      };
      store.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  private buildRateLimitResult(
    allowed: boolean,
    violatedDimension: 'IP' | 'USER' | 'API' | undefined,
    limit: number,
    remaining: number,
    resetAtMs: number,
    nowMs: number,
    routeKey: string,
  ): RateLimitCheckResult {
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
    return {
      allowed,
      ...(violatedDimension ? { violatedDimension, exceededDimension: violatedDimension } : {}),
      limit,
      remaining,
      resetAtMs,
      retryAfterSeconds,
      routeKey,
    };
  }
}
