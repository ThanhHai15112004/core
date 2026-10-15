import { Inject, Injectable, Optional } from '@nestjs/common';
import { ForbiddenAppException, UnauthorizedAppException } from '@packages/kernel/index.js';
import { PasswordHasherService, TokenService } from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  USER_STATUS,
  type UserAuthIdentityView,
} from '@modules/users/contracts/index.js';
import type { IAuthPublicService } from '../contracts/index.js';
import { SessionService } from './session.service.js';
import { MfaService } from './mfa.service.js';
import { SecuritySettingsService } from './security-settings.service.js';
import type {
  LoginRequest,
  RefreshTokenRequest,
  SendEmailOtpRequest,
  VerifyMfaChallengeRequest,
} from '../requests/auth.requests.js';
import type {
  AuthenticatedUserProfileResponse,
  LoginResponse,
  SendEmailOtpResponse,
} from '../responses/auth.response.js';

const DEFAULT_MAX_FAILED_LOGIN_ATTEMPTS = 5;
const DEFAULT_AUTO_LOCK_DURATION_MINUTES = 15;

@Injectable()
export class AuthService implements IAuthPublicService {
  constructor(
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly mfaService: MfaService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly securitySettingsService?: SecuritySettingsService,
  ) {}

  /** Đăng nhập bước 1 bằng Username/Email + Mật khẩu */
  public async login(
    dto: LoginRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<LoginResponse> {
    const credentials = await this.usersPublicService.findAuthUserByIdentifier(dto.identifier);
    if (!credentials || credentials.archivedAt || credentials.status === USER_STATUS.ARCHIVED) {
      throw new UnauthorizedAppException('auth.invalidCredentials');
    }

    // Kiểm tra trạng thái INACTIVE (2)
    if (credentials.status === USER_STATUS.INACTIVE) {
      throw new ForbiddenAppException('auth.accountInactive');
    }

    // Kiểm tra trạng thái LOCKED (3) (nếu thời hạn khóa đã qua thì tự động mở khóa)
    if (credentials.status === USER_STATUS.LOCKED) {
      if (credentials.lockedUntil && credentials.lockedUntil.getTime() <= Date.now()) {
        await this.usersPublicService.autoUnlockExpiredLock(credentials.id);
      } else {
        throw new ForbiddenAppException('auth.accountLocked', [
          {
            reason: credentials.lockReason,
            lockedUntil: credentials.lockedUntil ? credentials.lockedUntil.toISOString() : null,
          },
        ]);
      }
    }

    // Kiểm tra mật khẩu
    const isPasswordValid = await this.passwordHasher.verify(
      dto.password,
      credentials.passwordHash,
    );
    if (!isPasswordValid) {
      const settings = await this.securitySettingsService?.getSettings();
      const maxAttempts = settings?.maxFailedLoginAttempts ?? DEFAULT_MAX_FAILED_LOGIN_ATTEMPTS;
      const lockMinutes = settings?.lockoutDurationMinutes ?? DEFAULT_AUTO_LOCK_DURATION_MINUTES;

      const failure = await this.usersPublicService.recordLoginFailure(
        credentials.id,
        maxAttempts,
        lockMinutes,
      );
      if (failure.locked) {
        throw new ForbiddenAppException('auth.accountLockedDueToFailedAttempts', [
          {
            failedAttempts: failure.failedAttempts,
            lockedUntil: failure.lockedUntil ? failure.lockedUntil.toISOString() : null,
          },
        ]);
      }
      throw new UnauthorizedAppException('auth.invalidCredentials');
    }

    // Tự động nâng cấp chuỗi băm mật khẩu nếu Admin đã chuyển sang thuật toán băm mới trong Security Settings
    if (this.passwordHasher.needsRehash(credentials.passwordHash)) {
      const upgradedHash = await this.passwordHasher.hash(dto.password);
      await this.usersPublicService.updatePasswordHash(credentials.id, upgradedHash);
    }

    // Nếu tài khoản bật xác thực nhiều lớp (MFA) -> yêu cầu bước 2
    if (credentials.mfaEnabled) {
      const availableMethods = await this.mfaService.getAvailableMethodsForUser(credentials.id);
      const mfaChallengeToken = await this.tokenService.signMfaChallengeToken({
        sub: credentials.id,
        email: credentials.email,
        methods: availableMethods,
      });

      let emailOtpSent = false;
      if (availableMethods.includes('EMAIL_OTP') && !availableMethods.includes('TOTP')) {
        await this.mfaService.sendEmailOtp(credentials.id);
        emailOtpSent = true;
      }

      return {
        mfaRequired: true,
        mfaChallengeToken,
        availableMfaMethods: availableMethods,
        emailOtpSent,
        maskedEmail: this.mfaService.maskEmail(credentials.email),
      };
    }

    // Đăng nhập hoàn tất (không bật MFA)
    await this.usersPublicService.recordLoginSuccess(credentials.id);
    const identity = await this.usersPublicService.findAuthUserById(credentials.id);
    if (!identity) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const issued = await this.sessionService.createSession(identity, {
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      deviceName: dto.deviceName ?? null,
    });

    return {
      mfaRequired: false,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.sessionId,
      expiresInSeconds: issued.expiresInSeconds,
      user: this.toProfileResponse(identity),
    };
  }

  /** Xác thực mã MFA/2FA bước 2 (TOTP, Email OTP hoặc Recovery Code) để hoàn tất đăng nhập */
  public async verifyMfaChallenge(
    dto: VerifyMfaChallengeRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<LoginResponse> {
    const challengePayload = await this.tokenService.verifyMfaChallengeToken(dto.mfaChallengeToken);
    if (!challengePayload || !challengePayload.sub) {
      throw new UnauthorizedAppException('auth.invalidOrExpiredMfaChallenge');
    }

    const userId = Number(challengePayload.sub);
    const isCodeValid = await this.mfaService.verifyMfaCode(userId, dto.code, dto.method);
    if (!isCodeValid) {
      throw new UnauthorizedAppException('auth.invalidMfaCode');
    }

    await this.usersPublicService.recordLoginSuccess(userId);
    const identity = await this.usersPublicService.findAuthUserById(userId);
    if (!identity || identity.status !== USER_STATUS.ACTIVE) {
      throw new ForbiddenAppException('auth.accountNotActive');
    }

    const issued = await this.sessionService.createSession(identity, {
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      deviceName: dto.deviceName ?? null,
    });

    return {
      mfaRequired: false,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.sessionId,
      expiresInSeconds: issued.expiresInSeconds,
      user: this.toProfileResponse(identity),
    };
  }

  /** Gửi mã OTP 6 số qua Email (dùng trong bước MFA Challenge hoặc cho người dùng đã đăng nhập) */
  public async sendMfaEmailOtp(
    dto: SendEmailOtpRequest,
    authenticatedUserId?: number,
  ): Promise<SendEmailOtpResponse> {
    let targetUserId = authenticatedUserId;
    if (!targetUserId && dto.mfaChallengeToken) {
      const payload = await this.tokenService.verifyMfaChallengeToken(dto.mfaChallengeToken);
      if (!payload || !payload.sub) {
        throw new UnauthorizedAppException('auth.invalidOrExpiredMfaChallenge');
      }
      targetUserId = Number(payload.sub);
    }

    if (!targetUserId) {
      throw new UnauthorizedAppException('auth.mfaChallengeOrAuthRequired');
    }

    return this.mfaService.sendEmailOtp(targetUserId);
  }

  /** Làm mới Access Token bằng Refresh Token (Refresh Token Rotation) */
  public async refresh(dto: RefreshTokenRequest): Promise<LoginResponse> {
    const rotated = await this.sessionService.rotateRefreshSession(dto.refreshToken, (userId) =>
      this.usersPublicService.findAuthUserById(userId),
    );

    return {
      mfaRequired: false,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      sessionId: rotated.sessionId,
      expiresInSeconds: rotated.expiresInSeconds,
      user: this.toProfileResponse(rotated.user),
    };
  }

  /** Lấy thông tin hồ sơ của tài khoản đang đăng nhập */
  public async getMe(userId: number): Promise<AuthenticatedUserProfileResponse> {
    const identity = await this.usersPublicService.findAuthUserById(userId);
    if (!identity) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }
    return this.toProfileResponse(identity);
  }

  /** Hợp đồng công khai: Thu hồi toàn bộ phiên đăng nhập của người dùng */
  public async revokeAllUserSessions(userId: number, reason?: string): Promise<number> {
    return this.sessionService.revokeAllUserSessions(userId, reason);
  }

  /** Chuyển đổi UserAuthIdentityView sang DTO phản hồi hồ sơ */
  private toProfileResponse(identity: UserAuthIdentityView): AuthenticatedUserProfileResponse {
    return {
      id: identity.id,
      username: identity.username,
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      fullName: identity.fullName,
      phone: identity.phone,
      status: identity.status,
      statusName: identity.statusName,
      mfaEnabled: identity.mfaEnabled,
      primaryOrganizationUnitId: identity.primaryOrganizationUnitId,
      organizationUnitIds: [...identity.organizationUnitIds],
      roles: [...identity.roles],
      permissions: [...identity.permissions],
    };
  }
}
