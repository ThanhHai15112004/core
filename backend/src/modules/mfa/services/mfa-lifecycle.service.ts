import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  SettingRegistryService,
  UnauthorizedAppException,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { PasswordHasherService, TokenService, TotpService } from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  USER_STATUS,
  type UserAuthIdentityView,
} from '@modules/users/contracts/index.js';
import {
  AUTH_EVENT_STATUS,
  AUTH_EVENT_TYPE,
  SessionService,
  inferTrustedDeviceName,
} from '@modules/sessions/index.js';
import { SecuritySettingsService, resolveUserCredentialsById } from '@modules/credentials/index.js';
import {
  type AdminResetMfaInput,
  type AdminResetMfaResponse,
  type AdminResetMfaResult,
  DEFAULT_MAX_TRUSTED_DEVICES,
  DEFAULT_RECOVERY_CODE_COUNT,
  DEFAULT_TRUSTED_DEVICE_DAYS,
  MFA_METHOD,
  MFA_METHOD_NAME,
  type MfaMethodType,
  type MfaStatusResponse,
  type StoredTrustedDeviceRecord,
  type TrustedDeviceItemResponse,
} from '../contracts/index.js';
import type { AuthMfaConfigEntity } from '../entities/auth-mfa-config.entity.js';
import type { MfaChallengeAttemptTracker } from '../helpers/mfa-challenge-attempt.helper.js';
import {
  filterActiveTrustedDevices,
  normalizeRecoveryCode,
  parseExtendedMfaEnvelope,
  serializeExtendedMfaEnvelope,
  toTrustedDeviceResponse,
} from '../helpers/mfa-envelope.helper.js';
import { AuthMfaConfigRepository } from '../repositories/auth-mfa-config.repository.js';
import type { DisableMfaRequest, VerifyMfaChallengeRequest } from '../requests/mfa.requests.js';

export type MfaSecurityEventDelegate = (event: {
  userId: number;
  actorId?: number | null;
  eventType: 10 | 11;
  reason: string;
  metadata?: Record<string, unknown>;
}) => Promise<unknown>;

@Injectable()
export class MfaLifecycleService {
  private readonly logger = new Logger(MfaLifecycleService.name);
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly mfaRepository: AuthMfaConfigRepository,
    private readonly totpService: TotpService,
    private readonly passwordHasher: PasswordHasherService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly securitySettingsService?: SecuritySettingsService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly tokenService?: TokenService,
    @Optional() private readonly sessionService?: SessionService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  private getDefaultTrustedDeviceDays(): number {
    return Math.max(
      1,
      Math.min(
        365,
        this.settingRegistry.getNumber(
          'security.mfa.trusted_device_days',
          undefined,
          DEFAULT_TRUSTED_DEVICE_DAYS,
        ),
      ),
    );
  }

  private getMaxTrustedDevices(): number {
    return Math.max(
      1,
      this.settingRegistry.getNumber(
        'security.mfa.max_trusted_devices',
        undefined,
        DEFAULT_MAX_TRUSTED_DEVICES,
      ),
    );
  }

  public getRecoveryCodeCount(): number {
    return Math.max(
      4,
      Math.min(
        20,
        this.settingRegistry.getNumber(
          'security.mfa.recovery_code_count',
          undefined,
          DEFAULT_RECOVERY_CODE_COUNT,
        ),
      ),
    );
  }

  public async getStatus(userId: number): Promise<MfaStatusResponse> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return {
        mfaEnabled: false,
        totpEnabled: false,
        emailOtpEnabled: false,
        smsOtpEnabled: false,
        preferredMethod: 'TOTP',
        remainingRecoveryCodesCount: 0,
        remainingRecoveryCodes: 0,
        trustedDevicesCount: 0,
        verifiedAt: null,
      };
    }

    const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
    const activeTrustedDevices = filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    const smsOtpEnabled = Boolean(envelope.smsOtpEnabled);
    const mfaEnabled = Boolean(config.totpEnabled || config.emailOtpEnabled || smsOtpEnabled);
    const methodName = MFA_METHOD_NAME[config.preferredMethod] ?? 'TOTP';

    return {
      mfaEnabled,
      totpEnabled: Boolean(config.totpEnabled),
      emailOtpEnabled: Boolean(config.emailOtpEnabled),
      smsOtpEnabled,
      preferredMethod: methodName,
      remainingRecoveryCodesCount: envelope.codes.length,
      remainingRecoveryCodes: envelope.codes.length,
      trustedDevicesCount: activeTrustedDevices.length,
      verifiedAt: config.verifiedAt ? config.verifiedAt.toISOString() : null,
    };
  }

  public async getAvailableMethodsForUser(userId: number): Promise<MfaMethodType[]> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return ['EMAIL_OTP'];
    }

    const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
    const methods: MfaMethodType[] = [];
    if (config.totpEnabled && config.totpSecret) {
      methods.push('TOTP');
    }
    if (config.emailOtpEnabled) {
      methods.push('EMAIL_OTP');
    }
    if (envelope.smsOtpEnabled) {
      methods.push('SMS_OTP');
    }
    if (envelope.codes.length > 0) {
      methods.push('RECOVERY_CODE');
    }

    if (methods.length === 0) {
      methods.push('EMAIL_OTP');
    }
    return methods;
  }

  public async verifyMfaChallenge(
    dto: VerifyMfaChallengeRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null },
    mfaAttemptTracker: MfaChallengeAttemptTracker,
    verifyMfaCodeFn: (
      userId: number,
      code: string,
      preferredMethod?: MfaMethodType,
    ) => Promise<boolean>,
  ): Promise<{
    readonly mfaRequired: false;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly sessionId: number;
    readonly expiresInSeconds: number;
    readonly trustedDeviceToken?: string;
    readonly trustedDeviceExpiresAt?: string;
    readonly user: Omit<
      UserAuthIdentityView,
      'avatarUrl' | 'emailVerifiedAt' | 'phoneVerifiedAt'
    > & {
      readonly avatarUrl: string | null;
      readonly emailVerifiedAt: string | null;
      readonly phoneVerifiedAt: string | null;
      readonly preferredLocale: string;
      readonly preferredTimezone: string;
    };
  }> {
    if (!this.tokenService || !this.sessionService) {
      throw new UnauthorizedAppException('auth.invalidOrExpiredMfaChallenge');
    }
    const challengePayload = await this.tokenService.verifyMfaChallengeToken(dto.mfaChallengeToken);
    if (!challengePayload || !challengePayload.sub) {
      throw new UnauthorizedAppException('auth.invalidOrExpiredMfaChallenge');
    }

    const challengeHash = this.passwordHasher.sha256(dto.mfaChallengeToken);
    const currentAttempts = await mfaAttemptTracker.getAttempts(challengeHash);
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
    const isCodeValid = await verifyMfaCodeFn(userId, dto.code, dto.method);
    if (!isCodeValid) {
      await mfaAttemptTracker.incrementAttempts(challengeHash, currentAttempts);
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

    await mfaAttemptTracker.clearAttempts(challengeHash);

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
      const trusted = await this.registerTrustedDevice(userId, {
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

    const preferredLocale = identity.preferredLocale ?? identity.profile?.preferredLocale ?? 'vi';
    const preferredTimezone =
      identity.preferredTimezone ?? identity.profile?.preferredTimezone ?? 'Asia/Ho_Chi_Minh';

    return {
      mfaRequired: false,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      sessionId: issued.sessionId,
      expiresInSeconds: issued.expiresInSeconds,
      ...(trustedDeviceInfo ?? {}),
      user: {
        ...identity,
        avatarUrl: identity.avatarUrl ?? null,
        emailVerifiedAt: identity.emailVerifiedAt ? identity.emailVerifiedAt.toISOString() : null,
        phoneVerifiedAt: identity.phoneVerifiedAt ? identity.phoneVerifiedAt.toISOString() : null,
        preferredLocale,
        preferredTimezone,
      },
    };
  }

  public async registerTrustedDevice(
    userId: number,
    options: {
      deviceName?: string | null | undefined;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
      trustDurationDays?: number | undefined;
    } = {},
  ): Promise<{
    deviceId: string;
    trustedDeviceToken: string;
    trustedUntil: string;
    device: TrustedDeviceItemResponse;
  }> {
    let config = await this.findConfigByUserId(userId);
    if (!config) {
      config = await this.saveConfig({
        userId,
        totpSecret: null,
        totpEnabled: false,
        emailOtpEnabled: false,
        preferredMethod: MFA_METHOD.TOTP,
        recoveryCodesHashJson: '[]',
      });
    }

    const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
    const activeDevices = filterActiveTrustedDevices(envelope.trustedDevices ?? []);

    const deviceId = `td-${randomUUID()}`;
    const rawSecret = this.passwordHasher.generateRandomToken(24);
    const trustedDeviceToken = `${userId}.${deviceId}.${rawSecret}`;
    const tokenHash = this.passwordHasher.sha256(trustedDeviceToken);

    const days = Math.max(
      1,
      Math.min(365, options.trustDurationDays ?? this.getDefaultTrustedDeviceDays()),
    );
    const now = new Date();
    const trustedUntilDate = new Date(now.getTime() + days * 86_400_000);

    const record: StoredTrustedDeviceRecord = {
      deviceId,
      tokenHash,
      deviceName: options.deviceName ?? inferTrustedDeviceName(options.userAgent),
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ?? null,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      trustedUntil: trustedUntilDate.toISOString(),
    };

    envelope.trustedDevices = [record, ...activeDevices].slice(0, this.getMaxTrustedDevices());
    config.recoveryCodesHashJson = serializeExtendedMfaEnvelope(envelope);
    await this.saveConfig(config);

    return {
      deviceId,
      trustedDeviceToken,
      trustedUntil: record.trustedUntil,
      device: toTrustedDeviceResponse(record),
    };
  }

  public async verifyTrustedDevice(
    userId: number,
    rawTrustedDeviceToken?: string | null,
  ): Promise<boolean> {
    if (!rawTrustedDeviceToken || !rawTrustedDeviceToken.trim()) {
      return false;
    }

    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return false;
    }

    const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
    const activeDevices = filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    if (activeDevices.length === 0) {
      return false;
    }

    const candidateHash = this.passwordHasher.sha256(rawTrustedDeviceToken.trim());
    const matched = activeDevices.find((d) =>
      this.passwordHasher.safeEqualHex(d.tokenHash, candidateHash),
    );
    if (!matched) {
      return false;
    }

    matched.lastUsedAt = new Date().toISOString();
    envelope.trustedDevices = activeDevices;
    config.recoveryCodesHashJson = serializeExtendedMfaEnvelope(envelope);
    await this.saveConfig(config);
    return true;
  }

  public async listTrustedDevices(userId: number): Promise<TrustedDeviceItemResponse[]> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return [];
    }

    const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
    const activeDevices = filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    return activeDevices.map((d) => toTrustedDeviceResponse(d));
  }

  public async revokeTrustedDevice(
    userId: number,
    deviceId: string,
  ): Promise<{ revoked: true; deviceId: string }> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      throw new NotFoundAppException('auth.trustedDeviceNotFound', { deviceId });
    }

    const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
    const activeDevices = filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    const remaining = activeDevices.filter((d) => d.deviceId !== deviceId);

    if (remaining.length === activeDevices.length) {
      throw new NotFoundAppException('auth.trustedDeviceNotFound', { deviceId });
    }

    envelope.trustedDevices = remaining;
    config.recoveryCodesHashJson = serializeExtendedMfaEnvelope(envelope);
    await this.saveConfig(config);

    return { revoked: true, deviceId };
  }

  public async revokeAllTrustedDevices(
    userId: number,
  ): Promise<{ revoked: true; revokedCount: number }> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return { revoked: true, revokedCount: 0 };
    }

    const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
    const activeDevices = filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    const revokedCount = activeDevices.length;

    envelope.trustedDevices = [];
    config.recoveryCodesHashJson = serializeExtendedMfaEnvelope(envelope);
    await this.saveConfig(config);

    return { revoked: true, revokedCount };
  }

  public async adminResetUserMfa(
    userId: number,
    input: AdminResetMfaInput,
    actorId?: number,
    revokeSessionsCallback?: (userId: number, reason: string) => Promise<number>,
    securityEventDelegate?: MfaSecurityEventDelegate,
  ): Promise<AdminResetMfaResult & AdminResetMfaResponse> {
    if (input.stepUpToken && actorId && this.tokenService) {
      const ok = await this.verifyStepUpToken(actorId, input.stepUpToken, 'users.resetMfa');
      if (!ok) {
        throw new ForbiddenAppException('auth.invalidOrExpiredStepUpToken');
      }
    }

    const reason = input.reason?.trim();
    if (!reason || reason.length < 3) {
      throw new BadRequestAppException('auth.mfaResetReasonRequired');
    }

    const user = await this.usersPublicService.findAuthUserById(userId);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id: userId });
    }

    const config = await this.findConfigByUserId(userId);
    let revokedTrustedDevicesCount = 0;

    if (config) {
      const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
      revokedTrustedDevicesCount = filterActiveTrustedDevices(envelope.trustedDevices ?? []).length;

      config.totpEnabled = false;
      config.totpSecret = null;
      config.emailOtpEnabled = false;
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
      config.emailOtpFailedAttempts = 0;
      config.recoveryCodesHashJson = '[]';
      config.verifiedAt = null;
      await this.saveConfig(config);
    }

    await this.usersPublicService.setMfaEnabled(userId, false);

    let revokedSessionsCount = 0;
    const effectiveRevokeCallback =
      revokeSessionsCallback ??
      (this.sessionService
        ? (uid: number, r: string) => this.sessionService!.revokeAllUserSessions(uid, r)
        : undefined);
    if (input.revokeSessions !== false && effectiveRevokeCallback) {
      const sessionReason = `MFA reset by administrator${actorId ? ` #${actorId}` : ''}: ${reason}`;
      revokedSessionsCount = await effectiveRevokeCallback(userId, sessionReason);
    }

    const resetAt = new Date().toISOString();
    this.logger.log(
      `Controlled MFA reset executed for user #${userId} by actor #${actorId ?? 'system'} (reason="${reason}", ref="${input.verificationReference ?? 'N/A'}")`,
    );

    await securityEventDelegate?.({
      userId: Number(userId),
      actorId: actorId ?? null,
      eventType: 11,
      reason: `MFA reset by administrator${actorId ? ` #${actorId}` : ''}: ${reason}`,
      metadata: {
        verificationReference: input.verificationReference ?? null,
        revokedSessionsCount,
        revokedTrustedDevicesCount,
      },
    });

    return {
      reset: true,
      userId: Number(userId),
      revokedSessionsCount,
      revokedTrustedDevicesCount,
      reason,
      verificationReference: input.verificationReference ?? null,
      resetByActorId: actorId ?? null,
      resetAt,
    };
  }

  public async disableMfa(
    userId: number,
    dto: DisableMfaRequest,
    verifyMfaCodeFn: (userId: number, code: string) => Promise<boolean>,
    securityEventDelegate?: MfaSecurityEventDelegate,
  ): Promise<MfaStatusResponse> {
    if (dto.stepUpToken && this.tokenService) {
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

    const config = await this.findConfigByUserId(userId);
    if (!config) {
      await this.usersPublicService.setMfaEnabled(userId, false);
      await securityEventDelegate?.({
        userId: Number(userId),
        actorId: Number(userId),
        eventType: 10,
        reason: `User disabled MFA (${dto.method ?? 'ALL'})`,
        metadata: { method: dto.method ?? 'ALL', mfaEnabledAfter: false },
      });
      return this.getStatus(userId);
    }

    if (dto.code) {
      const ok = await verifyMfaCodeFn(userId, dto.code);
      if (!ok) {
        throw new BadRequestAppException('auth.invalidMfaCode');
      }
    }

    const envelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);

    if (dto.method === 'TOTP') {
      config.totpEnabled = false;
      config.totpSecret = null;
    } else if (dto.method === 'EMAIL_OTP') {
      config.emailOtpEnabled = false;
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
      config.emailOtpFailedAttempts = 0;
    } else if (dto.method === 'SMS_OTP') {
      envelope.smsOtpEnabled = false;
      envelope.smsOtpCodeHash = null;
      envelope.smsOtpExpiresAt = null;
      envelope.smsOtpFailedAttempts = 0;
      config.recoveryCodesHashJson = serializeExtendedMfaEnvelope(envelope);
    } else {
      config.totpEnabled = false;
      config.totpSecret = null;
      config.emailOtpEnabled = false;
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
      config.emailOtpFailedAttempts = 0;
      config.recoveryCodesHashJson = '[]';
    }

    const updatedEnvelope = parseExtendedMfaEnvelope(config.recoveryCodesHashJson);
    const stillEnabled = Boolean(
      config.totpEnabled || config.emailOtpEnabled || updatedEnvelope.smsOtpEnabled,
    );
    await this.saveConfig(config);
    await this.usersPublicService.setMfaEnabled(userId, stillEnabled);

    await securityEventDelegate?.({
      userId: Number(userId),
      actorId: Number(userId),
      eventType: 10,
      reason: `User disabled MFA (${dto.method ?? 'ALL'})`,
      metadata: { method: dto.method ?? 'ALL', mfaEnabledAfter: stillEnabled },
    });

    return this.getStatus(userId);
  }

  public async regenerateRecoveryCodes(userId: number): Promise<{ recoveryCodes: string[] }> {
    const config = await this.findConfigByUserId(userId);
    const envelope = config ? parseExtendedMfaEnvelope(config.recoveryCodesHashJson) : null;
    if (!config || (!config.totpEnabled && !config.emailOtpEnabled && !envelope?.smsOtpEnabled)) {
      throw new BadRequestAppException('auth.mfaNotEnabled');
    }

    const plainCodes = this.totpService.generateRecoveryCodes(this.getRecoveryCodeCount());
    const hashes = plainCodes.map((c) => this.passwordHasher.sha256(normalizeRecoveryCode(c)));
    if (envelope) {
      envelope.codes = hashes;
      config.recoveryCodesHashJson = serializeExtendedMfaEnvelope(envelope);
    } else {
      config.recoveryCodesHashJson = JSON.stringify(hashes);
    }
    await this.saveConfig(config);

    return { recoveryCodes: plainCodes };
  }

  public async verifyStepUpToken(
    userId: number,
    stepUpToken: string,
    expectedAction?: string,
  ): Promise<boolean> {
    if (!this.tokenService || !stepUpToken || !stepUpToken.trim()) {
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

  private async findConfigByUserId(userId: number): Promise<AuthMfaConfigEntity | null> {
    if (!this.mfaRepository) {
      throw new Error('AuthMfaConfigRepository is not initialized');
    }
    return await this.mfaRepository.findByUserId(userId);
  }

  private async saveConfig(
    data: Partial<AuthMfaConfigEntity> & { userId: number },
  ): Promise<AuthMfaConfigEntity> {
    if (!this.mfaRepository) {
      throw new Error('AuthMfaConfigRepository is not initialized');
    }
    return await this.mfaRepository.saveEntity(data);
  }
}
