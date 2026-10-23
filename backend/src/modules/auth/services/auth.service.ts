import { Inject, Injectable, Optional } from '@nestjs/common';
import { BaseCacheProvider } from '@packages/cache/index.js';
import {
  BadRequestAppException,
  ForbiddenAppException,
  SettingRegistryService,
  UnauthorizedAppException,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { PasswordHasherService, TokenService } from '@packages/security/index.js';
import {
  type AdminResetUserMfaInput,
  type AdminResetUserMfaResult,
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  USER_STATUS,
  type UserAuthIdentityView,
} from '@modules/users/contracts/index.js';
import { AUTH_EVENT_STATUS, AUTH_EVENT_TYPE, type IAuthPublicService } from '../contracts/index.js';
import { SessionService } from './session.service.js';
import { MfaService } from './mfa.service.js';
import { DEFAULT_ADMIN_ROLE_CODES, STEP_UP_TOKEN_TTL_SECONDS } from '../enum/auth.enum.js';
import {
  MfaChallengeAttemptTracker,
  issueLoginMfaStep2Challenge,
  verifyAndEnforceLoginAccountStatus,
  verifyLoginPasswordAndRehashIfNeeded,
} from '../helpers/mfa-challenge-attempt.helper.js';
import { resolveUserCredentialsById } from './password.service.js';
import { SecuritySettingsService } from './security-settings.service.js';
import { VerificationService } from './verification.service.js';
import type {
  AdminResetMfaRequest,
  DisableMfaRequest,
  LoginRequest,
  RefreshTokenRequest,
  RegisterRequest,
  SendEmailOtpRequest,
  SendSmsOtpRequest,
  StepUpVerifyRequest,
  UpdateMyPreferencesRequest,
  VerifyMfaChallengeRequest,
} from '../requests/auth.requests.js';
import type {
  AdminResetMfaResponse,
  AuthenticatedUserProfileResponse,
  LoginResponse,
  MfaStatusResponse,
  RegisterResponse,
  SendEmailOtpResponse,
  SendSmsOtpResponse,
  StepUpVerifyResponse,
  UserPreferencesResponse,
} from '../responses/auth.response.js';

@Injectable()
export class AuthService implements IAuthPublicService {
  private readonly mfaAttemptTracker: MfaChallengeAttemptTracker;
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly mfaService: MfaService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly securitySettingsService?: SecuritySettingsService,
    @Optional() private readonly verificationService?: VerificationService,
    @Optional() private readonly cacheProvider?: BaseCacheProvider | null,
    @Optional() settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.mfaAttemptTracker = new MfaChallengeAttemptTracker(
      () => this.cacheProvider,
      this.settingRegistry,
    );
    this.sessionService.setSecuritySettingsService(this.securitySettingsService);
    this.usersPublicService.registerAdminRevokeSessionsDelegate?.((userId, reason) =>
      this.sessionService.revokeAllUserSessions(userId, reason),
    );
    this.usersPublicService.registerUserLoginHistoryDelegate?.((userId, limit) =>
      this.sessionService.listUserLoginHistory(userId, limit),
    );
    this.usersPublicService.registerAdminResetMfaDelegate?.((userId, input, actorId) =>
      this.adminResetUserMfa(userId, input, actorId),
    );
    this.usersPublicService.registerStepUpVerificationDelegate?.((userId, stepUpToken, action) =>
      this.verifyStepUpToken(userId, stepUpToken, action),
    );
    this.mfaService.registerSecurityEventDelegate?.((evt) =>
      this.sessionService.recordAuthEvent({
        userId: evt.userId,
        actorId: evt.actorId ?? evt.userId,
        eventType: evt.eventType,
        status: AUTH_EVENT_STATUS.SUCCESS,
        reason: evt.reason,
        metadata: evt.metadata ?? null,
      }),
    );
  }

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
      preferredLocale: dto.preferredLocale ?? null,
      preferredTimezone: dto.preferredTimezone ?? null,
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
          ...(sent.devVerificationToken ? { devVerificationToken: sent.devVerificationToken } : {}),
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
   * Đăng nhập bước 1 bằng Username / Email / SĐT + Mật khẩu (Mục 3.2.3, 3.5.5, 3.5.6)
   * - Không tiết lộ tài khoản có tồn tại hay không (`auth.invalidCredentials`).
   * - Thực thi chính sách bắt buộc MFA theo vai trò (`mfaPolicy`: `REQUIRED_FOR_ADMINS` / `REQUIRED_FOR_ALL`).
   * - Hỗ trợ bỏ qua MFA trên Thiết bị tin cậy (`trustedDeviceToken`) còn thời hạn hiệu lực.
   */
  public async login(
    dto: LoginRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<LoginResponse> {
    const rawCredentials = await this.usersPublicService.findAuthUserByIdentifier(dto.identifier);
    const credentials = await verifyAndEnforceLoginAccountStatus({
      credentials: rawCredentials,
      dto,
      meta,
      sessionService: this.sessionService,
      usersPublicService: this.usersPublicService,
    });

    const activeSettings = await verifyLoginPasswordAndRehashIfNeeded({
      credentials,
      dto,
      meta,
      passwordHasher: this.passwordHasher,
      securitySettingsService: this.securitySettingsService,
      usersPublicService: this.usersPublicService,
      sessionService: this.sessionService,
    });

    const identity = await this.usersPublicService.findAuthUserById(credentials.id);
    if (!identity) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const mfaPolicy = activeSettings?.mfaPolicy ?? 'OPTIONAL';
    const isAdminUser = this.isAdministrativeUser(identity);
    const isPolicyEnforced =
      mfaPolicy === 'REQUIRED_FOR_ALL' || (mfaPolicy === 'REQUIRED_FOR_ADMINS' && isAdminUser);
    const mfaRequired = Boolean(credentials.mfaEnabled || isPolicyEnforced);

    if (mfaRequired) {
      if (dto.trustedDeviceToken) {
        const isTrustedDevice = await this.mfaService.verifyTrustedDevice(
          credentials.id,
          dto.trustedDeviceToken,
        );
        if (isTrustedDevice) {
          await this.usersPublicService.recordLoginSuccess(credentials.id);
          const issued = await this.sessionService.createSession(identity, {
            ipAddress: meta.ipAddress ?? null,
            userAgent: meta.userAgent ?? null,
            deviceName: dto.deviceName ?? null,
          });
          return {
            mfaRequired: false,
            trustedDeviceBypassed: true,
            accessToken: issued.accessToken,
            refreshToken: issued.refreshToken,
            sessionId: issued.sessionId,
            expiresInSeconds: issued.expiresInSeconds,
            user: this.toProfileResponse(identity),
          };
        }
      }

      const allowedByPolicy = activeSettings?.allowedMfaMethods ?? [
        'TOTP',
        'EMAIL_OTP',
        'SMS_OTP',
        'RECOVERY_CODE',
      ];
      return issueLoginMfaStep2Challenge({
        credentials,
        identity,
        dto,
        meta,
        mfaPolicy,
        isPolicyEnforced,
        allowedByPolicy,
        mfaService: this.mfaService,
        tokenService: this.tokenService,
        sessionService: this.sessionService,
      });
    }

    await this.usersPublicService.recordLoginSuccess(credentials.id);
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

  /** Xác thực mã MFA/2FA bước 2 (TOTP, Email OTP, SMS OTP hoặc Recovery Code) để hoàn tất đăng nhập */
  public async verifyMfaChallenge(
    dto: VerifyMfaChallengeRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<LoginResponse> {
    const challengePayload = await this.tokenService.verifyMfaChallengeToken(dto.mfaChallengeToken);
    if (!challengePayload || !challengePayload.sub) {
      throw new UnauthorizedAppException('auth.invalidOrExpiredMfaChallenge');
    }

    const challengeHash = this.passwordHasher.sha256(dto.mfaChallengeToken);
    const currentAttempts = await this.mfaAttemptTracker.getAttempts(challengeHash);
    const settings = await this.securitySettingsService?.getSettings();
    const maxMfaAttempts =
      settings?.otpMaxAttempts ??
      Math.max(1, this.settingRegistry.getNumber('security.otp.max_attempts', undefined, 5));
    if (currentAttempts >= maxMfaAttempts) {
      throw new UnauthorizedAppException('auth.invalidOrExpiredMfaChallenge');
    }

    if (
      dto.method &&
      Array.isArray(challengePayload.methods) &&
      challengePayload.methods.length > 0 &&
      !challengePayload.methods.includes(dto.method)
    ) {
      throw new ForbiddenAppException('auth.mfaMethodNotAllowedByPolicy', [
        { method: dto.method, allowedMethods: challengePayload.methods },
      ]);
    }

    const userId = Number(challengePayload.sub);
    const isCodeValid = await this.mfaService.verifyMfaCode(userId, dto.code, dto.method);
    if (!isCodeValid) {
      await this.mfaAttemptTracker.incrementAttempts(challengeHash, currentAttempts);
      await this.sessionService.recordAuthEvent({
        userId,
        identifier: challengePayload.email ?? null,
        eventType: AUTH_EVENT_TYPE.MFA_FAILED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        deviceName: dto.deviceName ?? null,
        reason: 'Invalid MFA verification code',
      });
      throw new UnauthorizedAppException('auth.invalidMfaCode');
    }

    await this.mfaAttemptTracker.clearAttempts(challengeHash);

    await this.usersPublicService.recordLoginSuccess(userId);
    const identity = await this.usersPublicService.findAuthUserById(userId);
    if (!identity || identity.status !== USER_STATUS.ACTIVE) {
      throw new ForbiddenAppException('auth.accountNotActive');
    }

    let trustedDeviceInfo:
      { trustedDeviceToken: string; trustedDeviceExpiresAt: string } | undefined;
    if (dto.trustDevice) {
      const defaultTrustDays = Math.max(
        1,
        this.settingRegistry.getNumber('security.mfa.trusted_device_days', undefined, 30),
      );
      const trusted = await this.mfaService.registerTrustedDevice(userId, {
        deviceName: dto.deviceName ?? null,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        trustDurationDays: dto.trustDurationDays ?? defaultTrustDays,
      });
      trustedDeviceInfo = {
        trustedDeviceToken: trusted.trustedDeviceToken,
        trustedDeviceExpiresAt: trusted.trustedUntil,
      };
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
      ...(trustedDeviceInfo ?? {}),
      user: this.toProfileResponse(identity),
    };
  }

  /** Gửi mã OTP 6 số qua Email (dùng trong bước MFA Challenge hoặc cho người dùng đã đăng nhập — Mục 3.5.1) */
  public async sendMfaEmailOtp(
    dto: SendEmailOtpRequest,
    authenticatedUserId?: number,
  ): Promise<SendEmailOtpResponse> {
    const targetUserId = await this.resolveMfaTargetUserId(
      authenticatedUserId,
      dto?.mfaChallengeToken,
    );
    return this.mfaService.sendEmailOtp(targetUserId);
  }

  /** Gửi mã OTP 6 số qua SMS (dùng trong bước MFA Challenge hoặc cho người dùng đã đăng nhập — Mục 3.5.2) */
  public async sendMfaSmsOtp(
    dto: SendSmsOtpRequest,
    authenticatedUserId?: number,
  ): Promise<SendSmsOtpResponse> {
    const targetUserId = await this.resolveMfaTargetUserId(
      authenticatedUserId,
      dto?.mfaChallengeToken,
    );
    return this.mfaService.sendSmsOtp(targetUserId, dto?.phone);
  }

  /**
   * Xác thực lại (Step-Up Authentication) bằng mật khẩu hiện tại hoặc mã MFA trước khi thực hiện thao tác nhạy cảm (Mục 3.5.7)
   * Cấp phát `stepUpToken` ngắn hạn (5 phút).
   */
  public async verifyStepUp(
    userId: number,
    dto: StepUpVerifyRequest,
    sessionId?: number,
  ): Promise<StepUpVerifyResponse> {
    const credentials = await resolveUserCredentialsById(this.usersPublicService, userId);
    if (!credentials || credentials.archivedAt || credentials.status !== USER_STATUS.ACTIVE) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    let verifiedMethod = '';

    if (dto.code && dto.code.trim()) {
      const mfaOk = await this.mfaService.verifyMfaCode(userId, dto.code.trim(), dto.method);
      if (!mfaOk) {
        throw new UnauthorizedAppException('auth.invalidMfaCode');
      }
      verifiedMethod = dto.method ?? 'MFA';
    } else if (dto.password && dto.password.trim()) {
      const pwdOk = await this.passwordHasher.verify(dto.password, credentials.passwordHash);
      if (!pwdOk) {
        throw new UnauthorizedAppException('auth.invalidCurrentPassword');
      }
      verifiedMethod = 'PASSWORD';
    } else {
      throw new BadRequestAppException('auth.stepUpCredentialsRequired');
    }

    const stepUpTtlSeconds = Math.max(
      60,
      this.settingRegistry.getNumber(
        'security.step_up.ttl_seconds',
        undefined,
        STEP_UP_TOKEN_TTL_SECONDS,
      ),
    );
    const stepUpToken = await this.tokenService.signStepUpToken(
      {
        sub: userId,
        ...(sessionId ? { sid: sessionId } : {}),
        ...(dto.action ? { action: dto.action } : {}),
        method: verifiedMethod,
      },
      stepUpTtlSeconds,
    );

    return {
      verified: true,
      stepUpToken,
      expiresInSeconds: stepUpTtlSeconds,
      method: verifiedMethod,
      action: dto.action ?? null,
    };
  }

  /** Kiểm tra tính hợp lệ của `stepUpToken` cho thao tác nhạy cảm (Mục 3.5.7) */
  public async verifyStepUpToken(
    userId: number,
    stepUpToken: string,
    expectedAction?: string,
  ): Promise<boolean> {
    if (!stepUpToken || !stepUpToken.trim()) {
      return false;
    }
    const payload = await this.tokenService.verifyStepUpToken(stepUpToken.trim());
    if (!payload || !payload.sub) {
      return false;
    }
    if (userId > 0 && Number(payload.sub) !== Number(userId)) {
      return false;
    }
    if (
      expectedAction &&
      typeof payload.action === 'string' &&
      payload.action.trim().length > 0 &&
      payload.action !== expectedAction
    ) {
      return false;
    }
    return true;
  }

  /** Tắt MFA có kiểm tra xác thực lại (Step-Up Token, mật khẩu hiện tại hoặc mã MFA — Mục 3.5.7) */
  public async disableMfa(userId: number, dto: DisableMfaRequest): Promise<MfaStatusResponse> {
    if (dto.stepUpToken) {
      const tokenOk = await this.verifyStepUpToken(userId, dto.stepUpToken, 'mfa.disable');
      if (!tokenOk) {
        throw new ForbiddenAppException('auth.invalidOrExpiredStepUpToken');
      }
    } else if (dto.currentPassword) {
      const credentials = await resolveUserCredentialsById(this.usersPublicService, userId);
      if (!credentials) {
        throw new UnauthorizedAppException('auth.userNotFound');
      }
      const pwdOk = await this.passwordHasher.verify(dto.currentPassword, credentials.passwordHash);
      if (!pwdOk) {
        throw new UnauthorizedAppException('auth.invalidCurrentPassword');
      }
    }

    return this.mfaService.disableMfa(userId, dto);
  }

  /**
   * Reset MFA có kiểm soát từ trang quản trị (Mục 3.5.8 — Có xác minh hoặc phê duyệt)
   * Xóa cấu hình MFA, thu hồi toàn bộ thiết bị tin cậy và phiên đăng nhập của người dùng.
   */
  public async adminResetUserMfa(
    userId: number,
    input: AdminResetUserMfaInput | AdminResetMfaRequest,
    actorId?: number,
  ): Promise<AdminResetUserMfaResult & AdminResetMfaResponse> {
    if (input.stepUpToken && actorId) {
      const ok = await this.verifyStepUpToken(actorId, input.stepUpToken, 'users.resetMfa');
      if (!ok) {
        throw new ForbiddenAppException('auth.invalidOrExpiredStepUpToken');
      }
    }

    const result = await this.mfaService.adminResetUserMfa(
      userId,
      {
        reason: input.reason,
        verificationReference: input.verificationReference,
        revokeSessions: input.revokeSessions,
      },
      actorId,
      (uid, reason) => this.sessionService.revokeAllUserSessions(uid, reason),
    );

    return result;
  }

  /** Làm mới Access Token bằng Refresh Token (Refresh Token Rotation) */
  public async refresh(
    dto: RefreshTokenRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<LoginResponse> {
    const rotated = await this.sessionService.rotateRefreshSession(
      dto.refreshToken,
      (userId) => this.usersPublicService.findAuthUserById(userId),
      meta,
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

  /** 5.3.2 & 5.3.5: Lấy tùy chọn ngôn ngữ (`preferredLocale`) và múi giờ (`preferredTimezone`) của người dùng đang đăng nhập */
  public async getMyPreferences(userId: number): Promise<UserPreferencesResponse> {
    if (typeof this.usersPublicService.getUserPreferences === 'function') {
      return this.usersPublicService.getUserPreferences(userId);
    }
    const identity = await this.usersPublicService.findAuthUserById(userId);
    if (!identity) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }
    const preferredLocale =
      identity.preferredLocale === 'en' || identity.profile?.preferredLocale === 'en' ? 'en' : 'vi';
    const preferredTimezone =
      identity.preferredTimezone ?? identity.profile?.preferredTimezone ?? 'Asia/Ho_Chi_Minh';
    return {
      userId: identity.id,
      preferredLocale,
      preferredTimezone,
      updatedAt: new Date().toISOString(),
    };
  }

  /** 5.3.2 & 5.3.5: Cập nhật tùy chọn ngôn ngữ (`preferredLocale`) và múi giờ (`preferredTimezone`) của người dùng đang đăng nhập */
  public async updateMyPreferences(
    userId: number,
    dto: UpdateMyPreferencesRequest,
  ): Promise<UserPreferencesResponse> {
    if (typeof this.usersPublicService.updateUserPreferences === 'function') {
      return this.usersPublicService.updateUserPreferences(userId, dto);
    }
    throw new BadRequestAppException('users.invalidPreferredLocale');
  }

  /** Đăng xuất phiên hiện tại bằng Refresh Token hoặc theo (userId, sessionId) (Mục 3.2.4 & 3.4.5) */
  public async logout(
    refreshTokenOrContext?:
      | string
      | {
          userId: number;
          sessionId?: number | undefined;
          ipAddress?: string | null;
          userAgent?: string | null;
        },
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<{ loggedOut: true }> {
    if (typeof refreshTokenOrContext === 'string' && refreshTokenOrContext.trim().length > 0) {
      const payload = await this.tokenService
        .verifyRefreshToken(refreshTokenOrContext.trim())
        .catch(() => null);
      if (payload?.sub && payload?.sid) {
        await this.sessionService.revokeSessionById(
          Number(payload.sub),
          Number(payload.sid),
          'User logged out',
          meta,
        );
      }
      return { loggedOut: true };
    }

    if (refreshTokenOrContext && typeof refreshTokenOrContext === 'object') {
      const ctxMeta = {
        ipAddress: refreshTokenOrContext.ipAddress ?? meta.ipAddress ?? null,
        userAgent: refreshTokenOrContext.userAgent ?? meta.userAgent ?? null,
      };
      if (refreshTokenOrContext.sessionId) {
        await this.sessionService.revokeSessionById(
          refreshTokenOrContext.userId,
          refreshTokenOrContext.sessionId,
          'User logged out',
          ctxMeta,
        );
      } else {
        await this.sessionService.revokeAllUserSessions(
          refreshTokenOrContext.userId,
          'User logged out',
          undefined,
          ctxMeta,
        );
      }
    }

    return { loggedOut: true };
  }

  /** Hợp đồng công khai: Thu hồi toàn bộ phiên đăng nhập của người dùng (Mục 3.2.5) */
  public async revokeAllUserSessions(
    userId: number,
    reason?: string,
    exceptSessionId?: number,
  ): Promise<number> {
    return this.sessionService.revokeAllUserSessions(userId, reason, exceptSessionId);
  }

  private isAdministrativeUser(identity: UserAuthIdentityView): boolean {
    const adminRoles = this.settingRegistry.getJson<string[]>(
      'security.mfa.admin_role_codes',
      undefined,
      DEFAULT_ADMIN_ROLE_CODES,
    );
    const adminRoleSet = new Set(
      (Array.isArray(adminRoles) ? adminRoles : DEFAULT_ADMIN_ROLE_CODES).map((r) =>
        String(r).trim().toUpperCase(),
      ),
    );
    if (identity.roles.some((r) => adminRoleSet.has(r.trim().toUpperCase()))) {
      return true;
    }
    if (
      identity.permissions.includes('users.update') ||
      identity.permissions.includes('roles.update') ||
      identity.permissions.includes('system.manage')
    ) {
      return true;
    }
    return false;
  }

  private async resolveMfaTargetUserId(
    authenticatedUserId?: number,
    mfaChallengeToken?: string,
  ): Promise<number> {
    let targetUserId = authenticatedUserId;
    if (!targetUserId && mfaChallengeToken) {
      const payload = await this.tokenService.verifyMfaChallengeToken(mfaChallengeToken);
      if (!payload || !payload.sub) {
        throw new UnauthorizedAppException('auth.invalidOrExpiredMfaChallenge');
      }
      targetUserId = Number(payload.sub);
    }

    if (!targetUserId) {
      throw new UnauthorizedAppException('auth.mfaChallengeOrAuthRequired');
    }

    return targetUserId;
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
    const preferredLocale = identity.preferredLocale ?? identity.profile?.preferredLocale ?? 'vi';
    const preferredTimezone =
      identity.preferredTimezone ?? identity.profile?.preferredTimezone ?? 'Asia/Ho_Chi_Minh';
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
      preferredLocale,
      preferredTimezone,
      ...(identity.profile ? { profile: identity.profile } : {}),
    };
  }
}
