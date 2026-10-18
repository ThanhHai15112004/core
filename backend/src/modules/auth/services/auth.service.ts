import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ForbiddenAppException,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import { PasswordHasherService, TokenService } from '@packages/security/index.js';
import {
  type AdminResetUserMfaInput,
  type AdminResetUserMfaResult,
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  USER_STATUS,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
} from '@modules/users/contracts/index.js';
import {
  AUTH_EVENT_STATUS,
  AUTH_EVENT_TYPE,
  type IAuthPublicService,
  type MfaMethodType,
} from '../contracts/index.js';
import { SessionService } from './session.service.js';
import { MfaService } from './mfa.service.js';
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
} from '../responses/auth.response.js';

const DEFAULT_MAX_FAILED_LOGIN_ATTEMPTS = 5;
const DEFAULT_AUTO_LOCK_DURATION_MINUTES = 15;
const STEP_UP_TOKEN_TTL_SECONDS = 300; // 5 phút
const ADMIN_ROLE_CODES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'SYSTEM_ADMIN',
  'IAM_ADMIN',
  'SECURITY_ADMIN',
]);

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
  ) {
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
   * Đăng nhập bước 1 bằng Username / Email / SĐT + Mật khẩu (Mục 3.2.3, 3.5.5, 3.5.6)
   * - Không tiết lộ tài khoản có tồn tại hay không (`auth.invalidCredentials`).
   * - Thực thi chính sách bắt buộc MFA theo vai trò (`mfaPolicy`: `REQUIRED_FOR_ADMINS` / `REQUIRED_FOR_ALL`).
   * - Hỗ trợ bỏ qua MFA trên Thiết bị tin cậy (`trustedDeviceToken`) còn thời hạn hiệu lực.
   */
  public async login(
    dto: LoginRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<LoginResponse> {
    const credentials = await this.usersPublicService.findAuthUserByIdentifier(dto.identifier);
    if (!credentials || credentials.archivedAt || credentials.status === USER_STATUS.ARCHIVED) {
      await this.sessionService.recordAuthEvent({
        userId: credentials?.id ?? null,
        identifier: dto.identifier,
        eventType: AUTH_EVENT_TYPE.LOGIN_FAILED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        deviceName: dto.deviceName ?? null,
        reason: credentials ? 'Account is archived' : 'Account not found',
      });
      throw new UnauthorizedAppException('auth.invalidCredentials');
    }

    // Kiểm tra trạng thái INACTIVE (2)
    if (credentials.status === USER_STATUS.INACTIVE) {
      await this.sessionService.recordAuthEvent({
        userId: credentials.id,
        identifier: dto.identifier,
        eventType: AUTH_EVENT_TYPE.LOGIN_FAILED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        deviceName: dto.deviceName ?? null,
        reason: 'Account is inactive',
      });
      throw new ForbiddenAppException('auth.accountInactive');
    }

    // Kiểm tra trạng thái LOCKED (3) (nếu thời hạn khóa đã qua thì tự động mở khóa)
    if (credentials.status === USER_STATUS.LOCKED) {
      if (credentials.lockedUntil && credentials.lockedUntil.getTime() <= Date.now()) {
        await this.usersPublicService.autoUnlockExpiredLock(credentials.id);
      } else {
        await this.sessionService.recordAuthEvent({
          userId: credentials.id,
          identifier: dto.identifier,
          eventType: AUTH_EVENT_TYPE.LOGIN_FAILED,
          status: AUTH_EVENT_STATUS.FAILED,
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
          deviceName: dto.deviceName ?? null,
          reason: `Account locked: ${credentials.lockReason ?? 'Locked'}`,
        });
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
      await this.sessionService.recordAuthEvent({
        userId: credentials.id,
        identifier: dto.identifier,
        eventType: AUTH_EVENT_TYPE.LOGIN_FAILED,
        status: AUTH_EVENT_STATUS.FAILED,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        deviceName: dto.deviceName ?? null,
        reason: failure.locked
          ? `Invalid password; account locked after ${failure.failedAttempts} attempts`
          : `Invalid password (attempt ${failure.failedAttempts}/${maxAttempts})`,
      });
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

    const identity = await this.usersPublicService.findAuthUserById(credentials.id);
    if (!identity) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    // Kiểm tra chính sách bắt buộc MFA theo vai trò (Mục 3.5.6)
    const mfaPolicy = activeSettings?.mfaPolicy ?? 'OPTIONAL';
    const isAdminUser = this.isAdministrativeUser(identity);
    const isPolicyEnforced =
      mfaPolicy === 'REQUIRED_FOR_ALL' || (mfaPolicy === 'REQUIRED_FOR_ADMINS' && isAdminUser);
    const mfaRequired = Boolean(credentials.mfaEnabled || isPolicyEnforced);

    if (mfaRequired) {
      // Kiểm tra nếu người dùng đăng nhập từ Thiết bị tin cậy (Trusted Device — Mục 3.5.5) còn thời hạn
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

      const configuredMethods = await this.mfaService.getAvailableMethodsForUser(credentials.id);
      const allowedByPolicy = activeSettings?.allowedMfaMethods ?? [
        'TOTP',
        'EMAIL_OTP',
        'SMS_OTP',
        'RECOVERY_CODE',
      ];

      let availableMethods = configuredMethods.filter((m) => allowedByPolicy.includes(m));
      if (!credentials.mfaEnabled && isPolicyEnforced) {
        const fallbackMethods: MfaMethodType[] = [];
        if (credentials.email && allowedByPolicy.includes('EMAIL_OTP')) {
          fallbackMethods.push('EMAIL_OTP');
        }
        if (credentials.phone && allowedByPolicy.includes('SMS_OTP')) {
          fallbackMethods.push('SMS_OTP');
        }
        if (fallbackMethods.length === 0) {
          fallbackMethods.push('EMAIL_OTP');
        }
        availableMethods = fallbackMethods;
      } else if (availableMethods.length === 0) {
        availableMethods = configuredMethods;
      }

      const mfaChallengeToken = await this.tokenService.signMfaChallengeToken({
        sub: credentials.id,
        email: credentials.email,
        methods: availableMethods,
      });

      let emailOtpSent = false;
      let smsOtpSent = false;
      let maskedPhone: string | undefined;
      let devOtpCode: string | undefined;

      if (!availableMethods.includes('TOTP')) {
        if (availableMethods.includes('EMAIL_OTP') && credentials.email) {
          const otpRes = await this.mfaService.sendEmailOtp(credentials.id);
          emailOtpSent = true;
          devOtpCode = otpRes.devOtpCode;
        } else if (availableMethods.includes('SMS_OTP') && credentials.phone) {
          const smsRes = await this.mfaService.sendSmsOtp(credentials.id, credentials.phone);
          smsOtpSent = true;
          maskedPhone = smsRes.maskedPhone;
          devOtpCode = smsRes.devOtpCode;
        }
      }

      await this.sessionService.recordAuthEvent({
        userId: credentials.id,
        identifier: dto.identifier,
        eventType: AUTH_EVENT_TYPE.MFA_CHALLENGE,
        status: AUTH_EVENT_STATUS.SUCCESS,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        deviceName: dto.deviceName ?? null,
        reason: isPolicyEnforced
          ? `MFA step-2 challenge issued (policy=${mfaPolicy})`
          : 'MFA step-2 challenge issued',
      });

      return {
        mfaRequired: true,
        ...(isPolicyEnforced ? { mfaPolicyEnforced: true } : {}),
        ...(!credentials.mfaEnabled && isPolicyEnforced ? { mfaEnrollmentRequired: true } : {}),
        mfaChallengeToken,
        availableMfaMethods: availableMethods,
        emailOtpSent,
        ...(smsOtpSent ? { smsOtpSent: true } : {}),
        maskedEmail: this.mfaService.maskEmail(credentials.email),
        ...(maskedPhone ? { maskedPhone } : {}),
        ...(devOtpCode ? { devOtpCode } : {}),
      };
    }

    // Đăng nhập hoàn tất (không bật MFA)
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

    const userId = Number(challengePayload.sub);
    const isCodeValid = await this.mfaService.verifyMfaCode(userId, dto.code, dto.method);
    if (!isCodeValid) {
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

    await this.usersPublicService.recordLoginSuccess(userId);
    const identity = await this.usersPublicService.findAuthUserById(userId);
    if (!identity || identity.status !== USER_STATUS.ACTIVE) {
      throw new ForbiddenAppException('auth.accountNotActive');
    }

    let trustedDeviceInfo: { trustedDeviceToken: string; trustedDeviceExpiresAt: string } | undefined;
    if (dto.trustDevice) {
      const trusted = await this.mfaService.registerTrustedDevice(userId, {
        deviceName: dto.deviceName ?? null,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        trustDurationDays: dto.trustDurationDays ?? 30,
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
    const credentials = await this.resolveUserCredentialsById(userId);
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

    const stepUpToken = await this.tokenService.signStepUpToken(
      {
        sub: userId,
        ...(sessionId ? { sid: sessionId } : {}),
        ...(dto.action ? { action: dto.action } : {}),
        method: verifiedMethod,
      },
      STEP_UP_TOKEN_TTL_SECONDS,
    );

    return {
      verified: true,
      stepUpToken,
      expiresInSeconds: STEP_UP_TOKEN_TTL_SECONDS,
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
      const credentials = await this.resolveUserCredentialsById(userId);
      if (!credentials) {
        throw new UnauthorizedAppException('auth.userNotFound');
      }
      const pwdOk = await this.passwordHasher.verify(
        dto.currentPassword,
        credentials.passwordHash,
      );
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
    if (identity.roles.some((r) => ADMIN_ROLE_CODES.has(r.trim().toUpperCase()))) {
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

  private async resolveUserCredentialsById(
    userId: number,
  ): Promise<UserAuthCredentialsView | null> {
    if (typeof this.usersPublicService.findAuthCredentialsByUserId === 'function') {
      const direct = await this.usersPublicService.findAuthCredentialsByUserId(userId);
      if (direct) return direct;
    }

    const identity = await this.usersPublicService.findAuthUserById(userId);
    if (!identity) return null;

    return (
      (await this.usersPublicService.findAuthUserByIdentifier(
        identity.email || identity.username,
      )) ?? null
    );
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
