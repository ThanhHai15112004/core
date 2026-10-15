import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ForbiddenAppException,
  NotFoundAppException,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import {
  PasswordHasherService,
  TokenService,
  parseDurationSeconds,
} from '@packages/security/index.js';
import { RedisService } from '@packages/redis/index.js';
import type { UserAuthIdentityView } from '@modules/users/contracts/index.js';
import { AuthSessionRepository } from '../repositories/auth-session.repository.js';
import type { SessionItemResponse } from '../responses/auth.response.js';

export const AUTH_SESSION_REDIS_PREFIX = 'iam:auth:session:';
const DEFAULT_ACCESS_TTL_SEC = 900; // 15m
const DEFAULT_REFRESH_TTL_SEC = 604_800; // 7d

export interface IssuedSessionTokens {
  readonly sessionId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessionRepository: AuthSessionRepository,
    private readonly tokenService: TokenService,
    private readonly passwordHasher: PasswordHasherService,
    @Optional() private readonly configService?: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** Tạo phiên đăng nhập mới và phát hành cặp Access Token + Refresh Token */
  public async createSession(
    user: UserAuthIdentityView,
    context: { ipAddress?: string | null; userAgent?: string | null; deviceName?: string | null },
  ): Promise<IssuedSessionTokens> {
    const sessionId = randomUUID();
    const accessTtlSec = parseDurationSeconds(
      this.configService?.auth.jwt.accessExpiration,
      DEFAULT_ACCESS_TTL_SEC,
    );
    const refreshTtlSec = parseDurationSeconds(
      this.configService?.auth.jwt.refreshExpiration,
      DEFAULT_REFRESH_TTL_SEC,
    );

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
      this.tokenService.signRefreshToken({ sub: user.id, sid: sessionId }, refreshTtlSec),
    ]);

    const refreshTokenHash = this.passwordHasher.sha256(refreshToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + refreshTtlSec * 1000);

    await this.sessionRepository.saveEntity({
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      deviceName: context.deviceName ?? this.extractDeviceName(context.userAgent),
      lastActiveAt: now,
      expiresAt,
      revokedAt: null,
      revokeReason: null,
    });

    await this.cacheActiveSession(sessionId, user.id, refreshTtlSec);

    return {
      sessionId,
      accessToken,
      refreshToken,
      expiresInSeconds: accessTtlSec,
    };
  }

  /** Xoay vòng Refresh Token (Refresh Token Rotation) và cấp cặp token mới */
  public async rotateRefreshSession(
    refreshToken: string,
    resolveUser: (userId: string) => Promise<UserAuthIdentityView | null>,
  ): Promise<IssuedSessionTokens & { user: UserAuthIdentityView }> {
    const payload = await this.tokenService.verifyRefreshToken(refreshToken);
    if (!payload || !payload.sid) {
      throw new UnauthorizedAppException('auth.invalidRefreshToken');
    }

    const tokenHash = this.passwordHasher.sha256(refreshToken);
    const session = await this.sessionRepository.findById(payload.sid);

    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedAppException('auth.sessionNotFound');
    }

    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedAppException('auth.sessionExpiredOrRevoked');
    }

    // Phát hiện dùng lại Refresh Token cũ đã xoay vòng -> thu hồi ngay phiên để chống đánh cắp
    if (session.refreshTokenHash !== tokenHash) {
      session.revokedAt = new Date();
      session.revokeReason = 'Refresh token reuse detected';
      await this.sessionRepository.saveEntity(session);
      await this.removeSessionCache(session.id);
      throw new UnauthorizedAppException('auth.refreshTokenReused');
    }

    const user = await resolveUser(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.revokeSessionById(session.userId, session.id, 'User account not active');
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
      this.tokenService.signRefreshToken({ sub: user.id, sid: session.id }, refreshTtlSec),
    ]);

    const now = new Date();
    session.refreshTokenHash = this.passwordHasher.sha256(newRefreshToken);
    session.lastActiveAt = now;
    session.expiresAt = new Date(now.getTime() + refreshTtlSec * 1000);
    await this.sessionRepository.saveEntity(session);
    await this.cacheActiveSession(session.id, user.id, refreshTtlSec);

    return {
      sessionId: session.id,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresInSeconds: accessTtlSec,
      user,
    };
  }

  /** Kiểm tra một phiên đăng nhập còn hiệu lực hay không */
  public async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    if (this.redis?.isReady()) {
      const cached = await this.redis.client
        .get(`${AUTH_SESSION_REDIS_PREFIX}${sessionId}`)
        .catch(() => null);
      if (cached === 'REVOKED') {
        return false;
      }
      if (cached === userId) {
        return true;
      }
    }

    const session = await this.sessionRepository.findById(sessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return false;
    }
    return true;
  }

  /** Liệt kê danh sách các phiên đang hoạt động của người dùng */
  public async listUserSessions(
    userId: string,
    currentSessionId?: string,
  ): Promise<SessionItemResponse[]> {
    const sessions = await this.sessionRepository.findActiveByUserId(userId);
    return sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      deviceName: s.deviceName ?? null,
      isCurrent: Boolean(currentSessionId && s.id === currentSessionId),
      lastActiveAt: s.lastActiveAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    }));
  }

  /** Thu hồi một phiên đăng nhập cụ thể của người dùng */
  public async revokeSessionById(
    userId: string,
    sessionId: string,
    reason = 'User logged out',
  ): Promise<{ revoked: true; sessionId: string }> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new NotFoundAppException('auth.sessionNotFound', { sessionId });
    }

    if (!session.revokedAt) {
      session.revokedAt = new Date();
      session.revokeReason = reason;
      await this.sessionRepository.saveEntity(session);
    }

    await this.removeSessionCache(sessionId);
    return { revoked: true, sessionId };
  }

  /** Thu hồi toàn bộ các phiên đăng nhập của người dùng (hỗ trợ giữ lại phiên hiện hành) */
  public async revokeAllUserSessions(
    userId: string,
    reason = 'Revoked all sessions',
    exceptSessionId?: string,
  ): Promise<number> {
    const revokedList = await this.sessionRepository.revokeAllForUser(
      userId,
      reason,
      exceptSessionId,
    );
    await Promise.all(revokedList.map((s) => this.removeSessionCache(s.id)));
    return revokedList.length;
  }

  /** Ghi trạng thái phiên hợp lệ lên Redis */
  private async cacheActiveSession(
    sessionId: string,
    userId: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client
      .set(`${AUTH_SESSION_REDIS_PREFIX}${sessionId}`, userId, 'EX', ttlSeconds)
      .catch(() => undefined);
  }

  /** Đánh dấu phiên đã thu hồi trên Redis */
  private async removeSessionCache(sessionId: string): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client
      .set(`${AUTH_SESSION_REDIS_PREFIX}${sessionId}`, 'REVOKED', 'EX', 3600)
      .catch(() => undefined);
  }

  /** Suy đoán tên thiết bị ngắn gọn từ chuỗi User-Agent */
  private extractDeviceName(userAgent?: string | null): string {
    if (!userAgent) return 'Unknown Device';
    if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iOS Device';
    if (/Android/i.test(userAgent)) return 'Android Device';
    if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac';
    if (/Windows/i.test(userAgent)) return 'Windows PC';
    if (/Linux/i.test(userAgent)) return 'Linux';
    return 'Web Browser';
  }
}
