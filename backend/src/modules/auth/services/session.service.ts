import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ForbiddenAppException,
  NotFoundAppException,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  PasswordHasherService,
  PlatformSecurityService,
  TokenService,
  parseDurationSeconds,
} from '@packages/security/index.js';
import { RedisService } from '@packages/redis/index.js';
import { USER_STATUS, type UserAuthIdentityView } from '@modules/users/contracts/index.js';
import {
  AUTH_EVENT_STATUS,
  AUTH_EVENT_TYPE,
  type AuthEventStatusCode,
  type AuthEventTypeCode,
  getAuthEventStatusName,
  getAuthEventTypeName,
} from '../contracts/index.js';
import type { AuthLoginHistoryEntity } from '../entities/auth-login-history.entity.js';
import { AuthLoginHistoryRepository } from '../repositories/auth-login-history.repository.js';
import { AuthSessionRepository } from '../repositories/auth-session.repository.js';
import type { LoginHistoryItemResponse, SessionItemResponse } from '../responses/auth.response.js';
import { SecuritySettingsService } from './security-settings.service.js';

export const AUTH_SESSION_REDIS_PREFIX = 'iam:auth:session:';
const DEFAULT_ACCESS_TTL_SEC = 900; // 15m
const DEFAULT_REFRESH_TTL_SEC = 604_800; // 7d
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30; // 30m
const DEFAULT_MAX_LIFETIME_MINUTES = 10_080; // 7d

export interface IssuedSessionTokens {
  readonly sessionId: number;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export interface RecordAuthEventInput {
  readonly userId?: number | null;
  readonly actorId?: number | null;
  readonly sessionId?: number | null;
  readonly identifier?: string | null;
  readonly eventType: AuthEventTypeCode;
  readonly status?: AuthEventStatusCode;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly deviceName?: string | null;
  readonly reason?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessionRepository: AuthSessionRepository,
    private readonly tokenService: TokenService,
    private readonly passwordHasher: PasswordHasherService,
    @Optional() private readonly configService?: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private securitySettingsService?: SecuritySettingsService,
    @Optional() private readonly loginHistoryRepository?: AuthLoginHistoryRepository,
    @Optional() private auditLogService?: AuditLogService,
    @Optional() private platformSecurityService?: PlatformSecurityService,
  ) {}

  /** Gắn SecuritySettingsService (hỗ trợ khởi tạo linh hoạt trong unit test harness) */
  public setSecuritySettingsService(service?: SecuritySettingsService): void {
    if (service) {
      this.securitySettingsService = service;
    }
  }

  /** Gắn AuditLogService & PlatformSecurityService (hỗ trợ khởi tạo linh hoạt trong unit test harness) */
  public setSecurityAuditDependencies(
    auditLogService?: AuditLogService,
    platformSecurityService?: PlatformSecurityService,
  ): void {
    if (auditLogService) {
      this.auditLogService = auditLogService;
    }
    if (platformSecurityService) {
      this.platformSecurityService = platformSecurityService;
    }
  }

  /** Đọc cấu hình thời hạn Idle Timeout, Max Session Lifetime và cờ bật/tắt Audit Login Log */
  private async resolveSessionPolicy(): Promise<{
    idleTimeoutMs: number;
    maxLifetimeMs: number;
    enableLoginAuditLog: boolean;
  }> {
    const settings = await this.securitySettingsService?.getSettings();
    const idleMinutes = settings?.sessionIdleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
    const maxLifetimeMinutes = settings?.sessionMaxLifetimeMinutes ?? DEFAULT_MAX_LIFETIME_MINUTES;
    const enableLoginAuditLog = settings?.enableLoginAuditLog !== false;

    return {
      idleTimeoutMs: idleMinutes > 0 ? idleMinutes * 60_000 : 0,
      maxLifetimeMs:
        maxLifetimeMinutes > 0 ? maxLifetimeMinutes * 60_000 : DEFAULT_REFRESH_TTL_SEC * 1000,
      enableLoginAuditLog,
    };
  }

  /**
   * Ghi lịch sử sự kiện Đăng nhập / Đăng xuất / Thu hồi phiên / MFA / Mật khẩu vào bảng `auth_login_history`
   * đồng thời đồng bộ sang `AuditLogService` (Mục 4.4) và `PlatformSecurityService` (Mục 4.5).
   */
  public async recordAuthEvent(
    input: RecordAuthEventInput,
  ): Promise<AuthLoginHistoryEntity | null> {
    const { enableLoginAuditLog } = await this.resolveSessionPolicy();
    if (!enableLoginAuditLog) {
      return null;
    }
    if (!this.loginHistoryRepository) {
      throw new Error('AuthLoginHistoryRepository is not initialized');
    }

    const deviceName = input.deviceName ?? this.extractDeviceName(input.userAgent);
    const status = input.status ?? AUTH_EVENT_STATUS.SUCCESS;
    const eventTypeName = getAuthEventTypeName(input.eventType);
    const statusName = getAuthEventStatusName(status);

    const savedHistory = await this.loginHistoryRepository.recordEvent({
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      identifier: input.identifier ?? null,
      eventType: input.eventType,
      status,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      deviceName,
      reason: input.reason ?? null,
    });

    const effectiveActorId = input.actorId ?? input.userId ?? null;

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'auth',
        feature:
          input.eventType === AUTH_EVENT_TYPE.MFA_DISABLED ||
          input.eventType === AUTH_EVENT_TYPE.MFA_RESET ||
          input.eventType === AUTH_EVENT_TYPE.MFA_CHALLENGE ||
          input.eventType === AUTH_EVENT_TYPE.MFA_FAILED
            ? 'mfa_security'
            : input.eventType === AUTH_EVENT_TYPE.PASSWORD_CHANGED ||
                input.eventType === AUTH_EVENT_TYPE.PASSWORD_RESET
              ? 'password_security'
              : 'session_auth',
        action: eventTypeName,
        actorId: effectiveActorId,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        resourceType: input.sessionId ? 'auth_session' : 'user',
        resourceId: input.sessionId ?? input.userId ?? input.identifier ?? null,
        reason: input.reason ?? null,
        afterData: {
          loginHistoryId: Number(savedHistory.id),
          userId: input.userId ?? null,
          sessionId: input.sessionId ?? null,
          identifier: input.identifier ?? null,
          eventType: input.eventType,
          eventTypeName,
          status,
          statusName,
          deviceName,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      });
    }

    if (this.platformSecurityService) {
      if (
        input.eventType === AUTH_EVENT_TYPE.LOGIN_FAILED ||
        input.eventType === AUTH_EVENT_TYPE.MFA_FAILED ||
        input.eventType === AUTH_EVENT_TYPE.TOKEN_REUSE_DETECTED ||
        input.eventType === AUTH_EVENT_TYPE.MFA_DISABLED ||
        input.eventType === AUTH_EVENT_TYPE.MFA_RESET ||
        input.eventType === AUTH_EVENT_TYPE.PASSWORD_CHANGED ||
        input.eventType === AUTH_EVENT_TYPE.PASSWORD_RESET
      ) {
        await this.platformSecurityService.recordSecurityEvent({
          eventType: eventTypeName,
          module: 'auth',
          feature: 'authentication',
          action: eventTypeName,
          actorId: effectiveActorId,
          targetUserId: input.userId ?? null,
          identifier: input.identifier ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          resourceType: input.sessionId ? 'auth_session' : 'user',
          resourceId: input.sessionId ?? input.userId ?? input.identifier ?? null,
          reason: input.reason ?? null,
          metadata: {
            loginHistoryId: Number(savedHistory.id),
            deviceName,
            ...(input.metadata ?? {}),
          },
          persistToAuditLog: false,
        });
      }
    }

    return savedHistory;
  }

  /** Tạo phiên đăng nhập mới và phát hành cặp Access Token + Refresh Token (Mục 3.4.1 & 3.4.3) */
  public async createSession(
    user: UserAuthIdentityView,
    context: { ipAddress?: string | null; userAgent?: string | null; deviceName?: string | null },
  ): Promise<IssuedSessionTokens> {
    const accessTtlSec = parseDurationSeconds(
      this.configService?.auth.jwt.accessExpiration,
      DEFAULT_ACCESS_TTL_SEC,
    );
    const refreshTtlSec = parseDurationSeconds(
      this.configService?.auth.jwt.refreshExpiration,
      DEFAULT_REFRESH_TTL_SEC,
    );

    const { maxLifetimeMs, idleTimeoutMs } = await this.resolveSessionPolicy();
    const now = new Date();
    const effectiveMaxSec = Math.min(refreshTtlSec, Math.floor(maxLifetimeMs / 1000));
    const expiresAt = new Date(now.getTime() + Math.max(1, effectiveMaxSec) * 1000);
    const resolvedDeviceName = context.deviceName ?? this.extractDeviceName(context.userAgent);

    const createdSession = await this.sessionRepository.saveEntity({
      userId: user.id,
      refreshTokenHash: 'pending',
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      deviceName: resolvedDeviceName,
      lastActiveAt: now,
      expiresAt,
      revokedAt: null,
      revokeReason: null,
    });

    const sessionId = Number(createdSession.id);

    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.signAccessToken(
        {
          sub: user.id,
          sid: sessionId,
          email: user.email,
          username: user.username,
          roles: [...user.roles],
          permissions: [...user.permissions],
          organizationUnitIds: [...user.organizationUnitIds],
        },
        accessTtlSec,
      ),
      this.tokenService.signRefreshToken(
        { sub: user.id, sid: sessionId },
        Math.max(1, effectiveMaxSec),
      ),
    ]);

    createdSession.refreshTokenHash = this.passwordHasher.sha256(refreshToken);
    await this.sessionRepository.saveEntity(createdSession);

    const redisTtlSec =
      idleTimeoutMs > 0
        ? Math.min(Math.max(1, effectiveMaxSec), Math.floor(idleTimeoutMs / 1000))
        : Math.max(1, effectiveMaxSec);
    await this.cacheActiveSession(sessionId, user.id, redisTtlSec);

    await this.recordAuthEvent({
      userId: user.id,
      sessionId,
      identifier: user.email || user.username,
      eventType: AUTH_EVENT_TYPE.LOGIN_SUCCESS,
      status: AUTH_EVENT_STATUS.SUCCESS,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      deviceName: resolvedDeviceName,
      reason: 'User logged in successfully',
    });

    return {
      sessionId,
      accessToken,
      refreshToken,
      expiresInSeconds: accessTtlSec,
    };
  }

  /** Xoay vòng Refresh Token (Refresh Token Rotation), kiểm tra Idle Timeout + Max Lifetime và phát hiện token dùng lại (Mục 3.4.2 & 3.4.3) */
  public async rotateRefreshSession(
    refreshToken: string,
    resolveUser: (userId: number) => Promise<UserAuthIdentityView | null>,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<IssuedSessionTokens & { user: UserAuthIdentityView }> {
    const payload = await this.tokenService.verifyRefreshToken(refreshToken);
    if (!payload || !payload.sid) {
      throw new UnauthorizedAppException('auth.invalidRefreshToken');
    }

    const sessionId = Number(payload.sid);
    const payloadUserId = Number(payload.sub);

    const tokenHash = this.passwordHasher.sha256(refreshToken);
    const session = await this.sessionRepository.findById(sessionId);

    if (!session || Number(session.userId) !== payloadUserId) {
      throw new UnauthorizedAppException('auth.sessionNotFound');
    }

    const nowMs = Date.now();
    const { idleTimeoutMs, maxLifetimeMs } = await this.resolveSessionPolicy();

    if (session.revokedAt || session.expiresAt.getTime() <= nowMs) {
      throw new UnauthorizedAppException('auth.sessionExpiredOrRevoked');
    }

    // Kiểm tra thời hạn tối đa tuyệt đối (Absolute Max Session Lifetime) tính từ lúc tạo phiên
    const createdMs = session.createdAt ? session.createdAt.getTime() : nowMs;
    if (maxLifetimeMs > 0 && nowMs - createdMs >= maxLifetimeMs) {
      session.revokedAt = new Date(nowMs);
      session.revokeReason = 'Session maximum lifetime exceeded';
      await this.sessionRepository.saveEntity(session);
      await this.removeSessionCache(session.id);
      await this.recordAuthEvent({
        userId: Number(session.userId),
        sessionId: Number(session.id),
        eventType: AUTH_EVENT_TYPE.SESSION_EXPIRED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: meta.ipAddress ?? session.ipAddress ?? null,
        userAgent: meta.userAgent ?? session.userAgent ?? null,
        deviceName: session.deviceName ?? null,
        reason: 'Session maximum lifetime exceeded',
      });
      throw new UnauthorizedAppException('auth.sessionExpiredOrRevoked');
    }

    // Kiểm tra thời gian không hoạt động (Idle Timeout)
    const lastActiveMs = session.lastActiveAt ? session.lastActiveAt.getTime() : createdMs;
    if (idleTimeoutMs > 0 && nowMs - lastActiveMs > idleTimeoutMs) {
      session.revokedAt = new Date(nowMs);
      session.revokeReason = 'Session idle timeout expired';
      await this.sessionRepository.saveEntity(session);
      await this.removeSessionCache(session.id);
      await this.recordAuthEvent({
        userId: Number(session.userId),
        sessionId: Number(session.id),
        eventType: AUTH_EVENT_TYPE.SESSION_EXPIRED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: meta.ipAddress ?? session.ipAddress ?? null,
        userAgent: meta.userAgent ?? session.userAgent ?? null,
        deviceName: session.deviceName ?? null,
        reason: 'Session idle timeout expired',
      });
      throw new UnauthorizedAppException('auth.sessionExpiredOrRevoked');
    }

    // Phát hiện dùng lại Refresh Token cũ đã xoay vòng -> thu hồi ngay phiên để chống đánh cắp
    if (!this.passwordHasher.safeEqualHex(session.refreshTokenHash, tokenHash)) {
      session.revokedAt = new Date(nowMs);
      session.revokeReason = 'Refresh token reuse detected';
      await this.sessionRepository.saveEntity(session);
      await this.removeSessionCache(session.id);
      await this.recordAuthEvent({
        userId: Number(session.userId),
        sessionId: Number(session.id),
        eventType: AUTH_EVENT_TYPE.TOKEN_REUSE_DETECTED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: meta.ipAddress ?? session.ipAddress ?? null,
        userAgent: meta.userAgent ?? session.userAgent ?? null,
        deviceName: session.deviceName ?? null,
        reason: 'Refresh token reuse detected; session revoked',
      });
      throw new UnauthorizedAppException('auth.refreshTokenReused');
    }

    const user = await resolveUser(Number(session.userId));
    if (!user || user.status !== USER_STATUS.ACTIVE) {
      await this.revokeSessionById(Number(session.userId), session.id, 'User account not active');
      throw new ForbiddenAppException('auth.accountNotActive');
    }

    const accessTtlSec = parseDurationSeconds(
      this.configService?.auth.jwt.accessExpiration,
      DEFAULT_ACCESS_TTL_SEC,
    );
    const refreshTtlSec = parseDurationSeconds(
      this.configService?.auth.jwt.refreshExpiration,
      DEFAULT_REFRESH_TTL_SEC,
    );

    const maxAllowedExpiresMs =
      maxLifetimeMs > 0 ? createdMs + maxLifetimeMs : nowMs + refreshTtlSec * 1000;
    const nextExpiresMs = Math.min(nowMs + refreshTtlSec * 1000, maxAllowedExpiresMs);
    const remainingSec = Math.max(1, Math.floor((nextExpiresMs - nowMs) / 1000));

    const [newAccessToken, newRefreshToken] = await Promise.all([
      this.tokenService.signAccessToken(
        {
          sub: user.id,
          sid: session.id,
          email: user.email,
          username: user.username,
          roles: [...user.roles],
          permissions: [...user.permissions],
          organizationUnitIds: [...user.organizationUnitIds],
        },
        accessTtlSec,
      ),
      this.tokenService.signRefreshToken({ sub: user.id, sid: session.id }, remainingSec),
    ]);

    const now = new Date(nowMs);
    session.refreshTokenHash = this.passwordHasher.sha256(newRefreshToken);
    session.lastActiveAt = now;
    session.expiresAt = new Date(nextExpiresMs);
    if (meta.ipAddress) session.ipAddress = meta.ipAddress;
    if (meta.userAgent) session.userAgent = meta.userAgent;
    await this.sessionRepository.saveEntity(session);

    const redisTtlSec =
      idleTimeoutMs > 0 ? Math.min(remainingSec, Math.floor(idleTimeoutMs / 1000)) : remainingSec;
    await this.cacheActiveSession(session.id, user.id, redisTtlSec);

    return {
      sessionId: Number(session.id),
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresInSeconds: accessTtlSec,
      user,
    };
  }

  /** Kiểm tra một phiên đăng nhập còn hiệu lực hay không (bao gồm Idle Timeout & Max Lifetime) */
  public async isSessionActive(sessionId: number, userId: number): Promise<boolean> {
    if (this.redis?.isReady()) {
      const cached = await this.redis.client
        .get(`${AUTH_SESSION_REDIS_PREFIX}${sessionId}`)
        .catch(() => null);
      if (cached === 'REVOKED') {
        return false;
      }
    }

    const session = await this.sessionRepository.findById(sessionId);
    if (!session || Number(session.userId) !== Number(userId)) {
      return false;
    }
    if (session.revokedAt) {
      return false;
    }

    const nowMs = Date.now();
    const { idleTimeoutMs, maxLifetimeMs } = await this.resolveSessionPolicy();
    const createdMs = session.createdAt ? session.createdAt.getTime() : nowMs;

    if (
      session.expiresAt.getTime() <= nowMs ||
      (maxLifetimeMs > 0 && nowMs - createdMs >= maxLifetimeMs)
    ) {
      session.revokedAt = new Date(nowMs);
      session.revokeReason = 'Session maximum lifetime exceeded';
      await this.sessionRepository.saveEntity(session);
      await this.removeSessionCache(session.id);
      await this.recordAuthEvent({
        userId: Number(session.userId),
        sessionId: Number(session.id),
        eventType: AUTH_EVENT_TYPE.SESSION_EXPIRED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        deviceName: session.deviceName ?? null,
        reason: 'Session maximum lifetime exceeded',
      });
      return false;
    }

    const lastActiveMs = session.lastActiveAt ? session.lastActiveAt.getTime() : createdMs;
    if (idleTimeoutMs > 0 && nowMs - lastActiveMs > idleTimeoutMs) {
      session.revokedAt = new Date(nowMs);
      session.revokeReason = 'Session idle timeout expired';
      await this.sessionRepository.saveEntity(session);
      await this.removeSessionCache(session.id);
      await this.recordAuthEvent({
        userId: Number(session.userId),
        sessionId: Number(session.id),
        eventType: AUTH_EVENT_TYPE.SESSION_EXPIRED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        deviceName: session.deviceName ?? null,
        reason: 'Session idle timeout expired',
      });
      return false;
    }

    session.lastActiveAt = new Date(nowMs);
    await this.sessionRepository.saveEntity(session);
    return true;
  }

  /** Liệt kê danh sách các phiên đang hoạt động của người dùng (Mục 3.4.4) */
  public async listUserSessions(
    userId: number,
    currentSessionId?: number,
  ): Promise<SessionItemResponse[]> {
    const { idleTimeoutMs, maxLifetimeMs } = await this.resolveSessionPolicy();
    const nowMs = Date.now();
    const sessions = await this.sessionRepository.findActiveByUserId(userId);
    const validSessions = sessions.filter((s) => {
      const createdMs = s.createdAt ? s.createdAt.getTime() : nowMs;
      const lastActiveMs = s.lastActiveAt ? s.lastActiveAt.getTime() : createdMs;
      if (maxLifetimeMs > 0 && nowMs - createdMs >= maxLifetimeMs) return false;
      if (idleTimeoutMs > 0 && nowMs - lastActiveMs > idleTimeoutMs) return false;
      return true;
    });

    return validSessions.map((s) => ({
      id: Number(s.id),
      userId: Number(s.userId),
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      deviceName: s.deviceName ?? null,
      isCurrent: Boolean(currentSessionId && Number(s.id) === Number(currentSessionId)),
      lastActiveAt: s.lastActiveAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
      revokeReason: s.revokeReason ?? null,
    }));
  }

  /** Xem lịch sử đăng nhập & đăng xuất theo thời gian, IP và thiết bị trực tiếp từ DB (Mục 3.4.7) */
  public async listUserLoginHistory(
    userId: number,
    limit = 50,
  ): Promise<LoginHistoryItemResponse[]> {
    if (!this.loginHistoryRepository) {
      throw new Error('AuthLoginHistoryRepository is not initialized');
    }
    const safeLimit = Math.max(1, Math.min(200, limit));
    const records = await this.loginHistoryRepository.findByUserId(userId, safeLimit);

    return records.map((r) => ({
      id: Number(r.id),
      userId: r.userId !== undefined && r.userId !== null ? Number(r.userId) : null,
      sessionId: r.sessionId !== undefined && r.sessionId !== null ? Number(r.sessionId) : null,
      identifier: r.identifier ?? null,
      eventType: Number(r.eventType),
      eventTypeName: getAuthEventTypeName(r.eventType),
      status: Number(r.status),
      statusName: getAuthEventStatusName(r.status),
      ipAddress: r.ipAddress ?? null,
      userAgent: r.userAgent ?? null,
      deviceName: r.deviceName ?? null,
      reason: r.reason ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Thu hồi một phiên đăng nhập cụ thể của người dùng (Mục 3.4.5) */
  public async revokeSessionById(
    userId: number,
    sessionId: number,
    reason = 'User logged out',
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<{ revoked: true; sessionId: number }> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session || Number(session.userId) !== Number(userId)) {
      throw new NotFoundAppException('auth.sessionNotFound', { sessionId });
    }

    if (!session.revokedAt) {
      session.revokedAt = new Date();
      session.revokeReason = reason;
      await this.sessionRepository.saveEntity(session);
    }

    await this.removeSessionCache(sessionId);

    const isSelfLogout = reason.toLowerCase().includes('logged out');
    await this.recordAuthEvent({
      userId: Number(userId),
      sessionId: Number(sessionId),
      eventType: isSelfLogout ? AUTH_EVENT_TYPE.LOGOUT : AUTH_EVENT_TYPE.SESSION_REVOKED,
      status: AUTH_EVENT_STATUS.SUCCESS,
      ipAddress: meta.ipAddress ?? session.ipAddress ?? null,
      userAgent: meta.userAgent ?? session.userAgent ?? null,
      deviceName: session.deviceName ?? null,
      reason,
    });

    return { revoked: true, sessionId: Number(sessionId) };
  }

  /** Thu hồi toàn bộ các phiên đăng nhập của người dùng (Mục 3.4.6 — hỗ trợ giữ lại phiên hiện hành) */
  public async revokeAllUserSessions(
    userId: number,
    reason = 'Revoked all sessions',
    exceptSessionId?: number,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<number> {
    const revokedList = await this.sessionRepository.revokeAllForUser(
      userId,
      reason,
      exceptSessionId,
    );
    await Promise.all(revokedList.map((s) => this.removeSessionCache(Number(s.id))));

    await this.recordAuthEvent({
      userId: Number(userId),
      sessionId: exceptSessionId ?? null,
      eventType: AUTH_EVENT_TYPE.SESSION_REVOKE_ALL,
      status: AUTH_EVENT_STATUS.SUCCESS,
      ipAddress: meta.ipAddress ?? revokedList[0]?.ipAddress ?? null,
      userAgent: meta.userAgent ?? revokedList[0]?.userAgent ?? null,
      deviceName: revokedList[0]?.deviceName ?? this.extractDeviceName(meta.userAgent),
      reason: `${reason} (revoked ${revokedList.length} sessions)`,
    });

    return revokedList.length;
  }

  /** Ghi trạng thái phiên hợp lệ lên Redis */
  private async cacheActiveSession(
    sessionId: number,
    userId: number,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client
      .set(`${AUTH_SESSION_REDIS_PREFIX}${sessionId}`, String(userId), 'EX', ttlSeconds)
      .catch(() => undefined);
  }

  /** Đánh dấu phiên đã thu hồi trên Redis */
  private async removeSessionCache(sessionId: number): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client
      .set(`${AUTH_SESSION_REDIS_PREFIX}${sessionId}`, 'REVOKED', 'EX', 3600)
      .catch(() => undefined);
  }

  /** Suy đoán tên thiết bị ngắn gọn từ chuỗi User-Agent */
  public extractDeviceName(userAgent?: string | null): string {
    if (!userAgent) return 'Unknown Device';
    if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iOS Device';
    if (/Android/i.test(userAgent)) return 'Android Device';
    if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac';
    if (/Windows/i.test(userAgent)) return 'Windows PC';
    if (/Linux/i.test(userAgent)) return 'Linux';
    return 'Web Browser';
  }
}
