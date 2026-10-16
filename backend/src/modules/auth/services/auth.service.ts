import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ForbiddenAppException,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
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
import { VerificationService } from './verification.service.js';
import type {
  LoginRequest,
  RefreshTokenRequest,
  RegisterRequest,
  SendEmailOtpRequest,
  VerifyMfaChallengeRequest,
} from '../requests/auth.requests.js';
import type {
  AuthenticatedUserProfileResponse,
  LoginResponse,
  RegisterResponse,
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
    @Optional() private readonly verificationService?: VerificationService,
  ) {}

  /**
   * Đăng ký tài khoản bằng Email + mật khẩu hoặc SĐT + mật khẩu (Mục 3.2.1 & 3.2.2)
   * Có thể bật hoặc tắt theo dự án qua SecuritySettingsService (`allowEmailRegistration` / `allowPhoneRegistration`).
   */
  public async register(
    dto: RegisterRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<RegisterResponse> {
    const hasEmail = Boolean(dto.email && dto.email.trim());
    const hasPhone = Boolean(dto.phone && dto.phone.trim());
    if (!hasEmail && !hasPhone) {
      throw new BadRequestAppException('auth.emailOrPhoneRequired');
    }

    const settings = await this.securitySettingsService?.getSettings();
    if (hasEmail && settings?.allowEmailRegistration === false) {
      throw new ForbiddenAppException('auth.emailRegistrationDisabled');
    }
    if (hasPhone && settings?.allowPhoneRegistration === false) {
      throw new ForbiddenAppException('auth.phoneRegistrationDisabled');
    }

    if (this.securitySettingsService) {
      await this.securitySettingsService.validatePasswordPolicy(dto.password, {
        username: dto.username,
        email: dto.email,
        phone: dto.phone,
      });
    } else {
      this.validatePasswordPolicy(dto.password, settings);
    }

    const emailVerifyRequired = hasEmail && Boolean(settings?.requireEmailVerification);
    const phoneVerifyRequired =
      !emailVerifyRequired && hasPhone && Boolean(settings?.requirePhoneVerification);
    const verificationRequired = emailVerifyRequired || phoneVerifyRequired;

    const created = await this.usersPublicService.registerSelfUser({
      username: dto.username,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      fullName: dto.fullName,
      avatarUrl: dto.avatarUrl ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      address: dto.address ?? null,
      city: dto.city ?? null,
      country: dto.country ?? null,
      bio: dto.bio ?? null,
      status: verificationRequired ? USER_STATUS.INACTIVE : USER_STATUS.ACTIVE,
    });

    if (verificationRequired) {
      if (emailVerifyRequired && this.verificationService) {
        const sent = await this.verificationService.sendEmailVerification(
          { email: created.email },
          { userId: created.id, ipAddress: meta.ipAddress },
        );
        return {
          registered: true,
          verificationRequired: true,
          verificationChannel: 'EMAIL',
          maskedTarget: sent.maskedTarget,
          expiresInSeconds: sent.expiresInSeconds,
          ...(sent.devVerificationCode ? { devVerificationCode: sent.devVerificationCode } : {}),
          ...(sent.devVerificationToken
            ? { devVerificationToken: sent.devVerificationToken }
            : {}),
          user: this.toProfileResponse(created),
        };
      }

      if (phoneVerifyRequired && this.verificationService) {
        const sent = await this.verificationService.sendPhoneOtp(
          { phone: created.phone ?? undefined },
          { userId: created.id, ipAddress: meta.ipAddress },
        );
        return {
          registered: true,
          verificationRequired: true,
          verificationChannel: 'PHONE_OTP',
          maskedTarget: sent.maskedTarget,
          expiresInSeconds: sent.expiresInSeconds,
          ...(sent.devVerificationCode ? { devVerificationCode: sent.devVerificationCode } : {}),
          user: this.toProfileResponse(created),
        };
      }

      return {
        registered: true,
        verificationRequired: true,
        verificationChannel: emailVerifyRequired ? 'EMAIL' : 'PHONE_OTP',
        user: this.toProfileResponse(created),
      };
    }

    await this.usersPublicService.recordLoginSuccess(created.id);
    const issued = await this.sessionService.createSession(created, {
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      deviceName: dto.deviceName ?? null,
    });

    return {
      registered: true,
      verificationRequired: false,
      verificationChannel: null,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.sessionId,
      expiresInSeconds: issued.expiresInSeconds,
      user: this.toProfileResponse(created),
    };
  }

  /**
   * Đăng nhập bước 1 bằng Username / Email / SĐT + Mật khẩu (Mục 3.2.3)
   * Không tiết lộ tài khoản có tồn tại hay không (`auth.invalidCredentials`).
   */
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

    // Tự động nâng cấp chuỗi băm mật khẩu nếu Admin đã chuyển sang thuật toán băm mới trong Security Settings (Mục 3.3.6)
    const activeSettings = await this.securitySettingsService?.getSettings();
    const targetHashAlgo = activeSettings?.passwordHashAlgorithm;
    if (this.passwordHasher.needsRehash(credentials.passwordHash, targetHashAlgo)) {
      const upgradedHash = await this.passwordHasher.hash(dto.password, targetHashAlgo);
      await this.usersPublicService.updatePasswordHash(credentials.id, upgradedHash, {
        recordHistory: false,
      });
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
      let devOtpCode: string | undefined;
      if (availableMethods.includes('EMAIL_OTP') && !availableMethods.includes('TOTP')) {
        const otpRes = await this.mfaService.sendEmailOtp(credentials.id);
        emailOtpSent = true;
        devOtpCode = otpRes.devOtpCode;
      }

      return {
        mfaRequired: true,
        mfaChallengeToken,
        availableMfaMethods: availableMethods,
        emailOtpSent,
        maskedEmail: this.mfaService.maskEmail(credentials.email),
        ...(devOtpCode ? { devOtpCode } : {}),
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

  /** Hợp đồng công khai: Thu hồi toàn bộ phiên đăng nhập của người dùng (Mục 3.2.5) */
  public async revokeAllUserSessions(
    userId: number,
    reason?: string,
    exceptSessionId?: number,
  ): Promise<number> {
    return this.sessionService.revokeAllUserSessions(userId, reason, exceptSessionId);
  }

  private validatePasswordPolicy(
    password: string,
    settings?: {
      passwordMinLength: number;
      requireUppercase: boolean;
      requireNumbers: boolean;
      requireSpecialChars: boolean;
    },
  ): void {
    const minLength = settings?.passwordMinLength ?? 8;
    if (password.length < minLength) {
      throw new BadRequestAppException('auth.passwordPolicyViolation', [{ minLength }]);
    }
    if (settings?.requireUppercase && !/[A-Z]/.test(password)) {
      throw new BadRequestAppException('auth.passwordPolicyViolation', [
        { requireUppercase: true },
      ]);
    }
    if (settings?.requireNumbers && !/\d/.test(password)) {
      throw new BadRequestAppException('auth.passwordPolicyViolation', [{ requireNumbers: true }]);
    }
    if (settings?.requireSpecialChars && !/[^A-Za-z0-9]/.test(password)) {
      throw new BadRequestAppException('auth.passwordPolicyViolation', [
        { requireSpecialChars: true },
      ]);
    }
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
      avatarUrl: identity.avatarUrl ?? null,
      phone: identity.phone,
      status: identity.status,
      statusName: identity.statusName,
      emailVerifiedAt: identity.emailVerifiedAt ? identity.emailVerifiedAt.toISOString() : null,
      phoneVerifiedAt: identity.phoneVerifiedAt ? identity.phoneVerifiedAt.toISOString() : null,
      mfaEnabled: identity.mfaEnabled,
      primaryOrganizationUnitId: identity.primaryOrganizationUnitId,
      organizationUnitIds: [...identity.organizationUnitIds],
      roles: [...identity.roles],
      permissions: [...identity.permissions],
      ...(identity.profile ? { profile: identity.profile } : {}),
    };
  }
}
