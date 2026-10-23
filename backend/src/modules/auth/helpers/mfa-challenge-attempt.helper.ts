import type { BaseCacheProvider } from '@packages/cache/index.js';
import {
  ForbiddenAppException,
  type SettingRegistryService,
  UnauthorizedAppException,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import type { PasswordHasherService, TokenService } from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USER_STATUS,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
} from '@modules/users/contracts/index.js';
import { AUTH_EVENT_STATUS, AUTH_EVENT_TYPE, type MfaMethodType } from '../contracts/index.js';
import {
  DEFAULT_AUTO_LOCK_DURATION_MINUTES,
  DEFAULT_MAX_FAILED_LOGIN_ATTEMPTS,
  MFA_CHALLENGE_ATTEMPT_TTL_SEC,
  MFA_CHALLENGE_MAX_L1_ENTRIES,
} from '../enum/auth.enum.js';
import type { LoginRequest } from '../requests/auth.requests.js';
import type { LoginResponse } from '../responses/auth.response.js';
import type { MfaService } from '../services/mfa.service.js';
import type { SecuritySettingsService } from '../services/security-settings.service.js';
import type { SessionService } from '../services/session.service.js';

/**
 * Bộ theo dõi số lần thử thách thức MFA hỗ trợ đồng bộ đa tiến trình (Multi-instance) qua L2 Cache (Redis)
 * kèm bộ đệm L1 có giới hạn kích thước và tự động thu hồi theo TTL (chống rò rỉ bộ nhớ).
 */
export class MfaChallengeAttemptTracker {
  private readonly l1Store = new Map<string, { count: number; expiresAtMs: number }>();

  constructor(
    private readonly getCacheProvider?: () => BaseCacheProvider | null | undefined,
    private readonly settingRegistry: SettingRegistryService = defaultSettingRegistry,
  ) {}

  private getAttemptTtlSeconds(): number {
    return Math.max(
      60,
      this.settingRegistry.getNumber(
        'security.mfa.challenge_ttl_seconds',
        undefined,
        MFA_CHALLENGE_ATTEMPT_TTL_SEC,
      ),
    );
  }

  private buildCacheKey(challengeHash: string): string {
    return `auth:mfa:challenge:attempts:${challengeHash}`;
  }

  private pruneExpiredL1(nowMs: number): void {
    if (this.l1Store.size < MFA_CHALLENGE_MAX_L1_ENTRIES) {
      return;
    }
    for (const [k, entry] of this.l1Store.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.l1Store.delete(k);
      }
    }
    if (this.l1Store.size >= MFA_CHALLENGE_MAX_L1_ENTRIES) {
      const oldestKey = this.l1Store.keys().next().value;
      if (oldestKey) {
        this.l1Store.delete(oldestKey);
      }
    }
  }

  public async getAttempts(challengeHash: string): Promise<number> {
    const nowMs = Date.now();
    const local = this.l1Store.get(challengeHash);
    const localCount = local && local.expiresAtMs > nowMs ? local.count : 0;
    if (local && local.expiresAtMs <= nowMs) {
      this.l1Store.delete(challengeHash);
    }

    const cache = this.getCacheProvider?.();
    if (cache) {
      try {
        const remoteCount = await cache.get<number>(this.buildCacheKey(challengeHash));
        if (typeof remoteCount === 'number' && Number.isFinite(remoteCount)) {
          return Math.max(localCount, remoteCount);
        }
      } catch {
        // Fallback to L1
      }
    }
    return localCount;
  }

  public async incrementAttempts(challengeHash: string, currentAttempts: number): Promise<number> {
    const nextAttempts = currentAttempts + 1;
    const nowMs = Date.now();
    const ttlSec = this.getAttemptTtlSeconds();
    this.pruneExpiredL1(nowMs);
    this.l1Store.set(challengeHash, {
      count: nextAttempts,
      expiresAtMs: nowMs + ttlSec * 1000,
    });

    const cache = this.getCacheProvider?.();
    if (cache) {
      try {
        await cache.set(this.buildCacheKey(challengeHash), nextAttempts, ttlSec);
      } catch {
        // Ignore L2 cache errors
      }
    }
    return nextAttempts;
  }

  public async clearAttempts(challengeHash: string): Promise<void> {
    this.l1Store.delete(challengeHash);
    const cache = this.getCacheProvider?.();
    if (cache) {
      try {
        await cache.delete(this.buildCacheKey(challengeHash));
      } catch {
        // Ignore L2 cache errors
      }
    }
  }
}

export async function verifyAndEnforceLoginAccountStatus(params: {
  credentials: UserAuthCredentialsView | null;
  dto: LoginRequest;
  meta: { ipAddress?: string | null; userAgent?: string | null };
  sessionService: SessionService;
  usersPublicService: IUsersPublicService;
}): Promise<UserAuthCredentialsView> {
  const { credentials, dto, meta, sessionService, usersPublicService } = params;

  if (!credentials || credentials.archivedAt || credentials.status === USER_STATUS.ARCHIVED) {
    await sessionService.recordAuthEvent({
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

  if (credentials.status === USER_STATUS.INACTIVE) {
    await sessionService.recordAuthEvent({
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

  if (credentials.status === USER_STATUS.LOCKED) {
    if (credentials.lockedUntil && credentials.lockedUntil.getTime() <= Date.now()) {
      await usersPublicService.autoUnlockExpiredLock(credentials.id);
    } else {
      await sessionService.recordAuthEvent({
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

  return credentials;
}

export async function verifyLoginPasswordAndRehashIfNeeded(params: {
  credentials: UserAuthCredentialsView;
  dto: LoginRequest;
  meta: { ipAddress?: string | null; userAgent?: string | null };
  passwordHasher: PasswordHasherService;
  securitySettingsService?: SecuritySettingsService | undefined;
  usersPublicService: IUsersPublicService;
  sessionService: SessionService;
}): Promise<Awaited<ReturnType<SecuritySettingsService['getSettings']>> | undefined> {
  const {
    credentials,
    dto,
    meta,
    passwordHasher,
    securitySettingsService,
    usersPublicService,
    sessionService,
  } = params;

  const isPasswordValid = await passwordHasher.verify(dto.password, credentials.passwordHash);
  if (!isPasswordValid) {
    const settings = await securitySettingsService?.getSettings();
    const maxAttempts = settings?.maxFailedLoginAttempts ?? DEFAULT_MAX_FAILED_LOGIN_ATTEMPTS;
    const lockMinutes = settings?.lockoutDurationMinutes ?? DEFAULT_AUTO_LOCK_DURATION_MINUTES;

    const failure = await usersPublicService.recordLoginFailure(
      credentials.id,
      maxAttempts,
      lockMinutes,
    );
    await sessionService.recordAuthEvent({
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

  const activeSettings = await securitySettingsService?.getSettings();
  const targetHashAlgo = activeSettings?.passwordHashAlgorithm;
  if (passwordHasher.needsRehash(credentials.passwordHash, targetHashAlgo)) {
    const upgradedHash = await passwordHasher.hash(dto.password, targetHashAlgo);
    await usersPublicService.updatePasswordHash(credentials.id, upgradedHash, {
      recordHistory: false,
    });
  }

  return activeSettings;
}

export async function issueLoginMfaStep2Challenge(params: {
  credentials: UserAuthCredentialsView;
  identity: UserAuthIdentityView;
  dto: LoginRequest;
  meta: { ipAddress?: string | null; userAgent?: string | null };
  mfaPolicy: string;
  isPolicyEnforced: boolean;
  allowedByPolicy: readonly MfaMethodType[];
  mfaService: MfaService;
  tokenService: TokenService;
  sessionService: SessionService;
}): Promise<LoginResponse> {
  const {
    credentials,
    dto,
    meta,
    mfaPolicy,
    isPolicyEnforced,
    allowedByPolicy,
    mfaService,
    tokenService,
    sessionService,
  } = params;

  const configuredMethods = await mfaService.getAvailableMethodsForUser(credentials.id);
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

  const mfaChallengeToken = await tokenService.signMfaChallengeToken({
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
      const otpRes = await mfaService.sendEmailOtp(credentials.id);
      emailOtpSent = true;
      devOtpCode = otpRes.devOtpCode;
    } else if (availableMethods.includes('SMS_OTP') && credentials.phone) {
      const smsRes = await mfaService.sendSmsOtp(credentials.id, credentials.phone);
      smsOtpSent = true;
      maskedPhone = smsRes.devOtpCode ? smsRes.maskedPhone : smsRes.maskedPhone;
      devOtpCode = smsRes.devOtpCode;
    }
  }

  await sessionService.recordAuthEvent({
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
    maskedEmail: mfaService.maskEmail(credentials.email),
    ...(maskedPhone ? { maskedPhone } : {}),
    ...(devOtpCode ? { devOtpCode } : {}),
  };
}
