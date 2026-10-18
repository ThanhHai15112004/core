import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BadRequestAppException,
  ForbiddenAppException,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import { PasswordHasherService } from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  normalizePhoneNumber,
} from '@modules/users/contracts/index.js';
import {
  AUTH_EMAIL_NOTIFICATION_ADAPTER,
  AUTH_SMS_OTP_PROVIDER,
  type IEmailNotificationAdapter,
  type ISmsOtpProvider,
} from '../contracts/index.js';
import {
  type AuthVerificationCodeEntity,
  VERIFICATION_CHANNEL,
  VERIFICATION_PURPOSE,
  type VerificationChannelCode,
  type VerificationPurposeCode,
} from '../entities/auth-verification-code.entity.js';
import { AuthVerificationCodeRepository } from '../repositories/auth-verification-code.repository.js';
import { SecuritySettingsService } from './security-settings.service.js';
import {
  DefaultEmailNotificationAdapter,
  DefaultSmsOtpProvider,
} from './notification-adapters.provider.js';
import type {
  ConfirmEmailVerificationRequest,
  ConfirmPhoneOtpVerificationRequest,
  SendEmailVerificationRequest,
  SendPhoneOtpVerificationRequest,
} from '../requests/auth.requests.js';
import type {
  VerificationConfirmResponse,
  VerificationSendResponse,
} from '../responses/auth.response.js';

const EMAIL_VERIFICATION_TTL_SECONDS = 900; // 15 phút
const PHONE_OTP_TTL_SECONDS = 300; // 5 phút
const DEFAULT_OTP_MAX_SENDS = 5;
const DEFAULT_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_OTP_COOLDOWN_SECONDS = 60;

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private fallbackSeq = 0;
  private readonly fallbackStore = new Map<number, AuthVerificationCodeEntity>();
  private readonly emailAdapter: IEmailNotificationAdapter;
  private readonly smsProvider: ISmsOtpProvider;

  constructor(
    private readonly passwordHasher: PasswordHasherService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly verificationRepo?: AuthVerificationCodeRepository,
    @Optional() private readonly securitySettingsService?: SecuritySettingsService,
    @Optional() private readonly configService?: CoreConfigService,
    @Optional()
    @Inject(AUTH_EMAIL_NOTIFICATION_ADAPTER)
    emailAdapter?: IEmailNotificationAdapter,
    @Optional()
    @Inject(AUTH_SMS_OTP_PROVIDER)
    smsProvider?: ISmsOtpProvider,
  ) {
    this.emailAdapter = emailAdapter ?? new DefaultEmailNotificationAdapter();
    this.smsProvider = smsProvider ?? new DefaultSmsOtpProvider();
  }

  /** Gửi link hoặc mã xác minh Email có thời hạn (Mục 3.2.6 & 3.5.1) */
  public async sendEmailVerification(
    dto: SendEmailVerificationRequest,
    options: { userId?: number | undefined; ipAddress?: string | null | undefined } = {},
  ): Promise<VerificationSendResponse> {
    const user = await this.resolveTargetUser(options.userId, dto.email);
    if (!user || !user.email) {
      throw new BadRequestAppException('auth.emailNotFoundForVerification');
    }

    const policy = await this.getOtpPolicy();
    const existing = await this.findLatestUnverified(
      user.id,
      VERIFICATION_CHANNEL.EMAIL,
      VERIFICATION_PURPOSE.VERIFY_EMAIL,
    );

    const now = new Date();
    let sendCount = 1;

    if (existing && existing.expiresAt.getTime() > now.getTime()) {
      const elapsedSec = (now.getTime() - existing.lastSentAt.getTime()) / 1000;
      if (policy.cooldownSeconds > 0 && elapsedSec < policy.cooldownSeconds) {
        throw new BadRequestAppException('auth.otpCooldownActive', [
          { retryAfterSeconds: Math.ceil(policy.cooldownSeconds - elapsedSec) },
        ]);
      }
      if (existing.sendCount >= policy.maxSends) {
        throw new ForbiddenAppException('auth.otpSendLimitExceeded', [
          { sendCount: existing.sendCount, maxSends: policy.maxSends },
        ]);
      }
      sendCount = existing.sendCount + 1;
    }

    const otpCode = this.passwordHasher.generateNumericOtp(6);
    const linkToken = this.passwordHasher.generateRandomToken(24);
    const combinedHash = `${this.passwordHasher.sha256(otpCode)}:${this.passwordHasher.sha256(linkToken)}`;
    const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_SECONDS * 1000);

    await this.saveVerificationRecord(existing, {
      userId: user.id,
      channel: VERIFICATION_CHANNEL.EMAIL,
      purpose: VERIFICATION_PURPOSE.VERIFY_EMAIL,
      target: user.email.toLowerCase(),
      codeHash: combinedHash,
      attemptCount: 0,
      maxAttempts: policy.maxAttempts,
      sendCount,
      maxSends: policy.maxSends,
      lastSentAt: now,
      expiresAt,
      verifiedAt: null,
      requestedIp: options.ipAddress ?? null,
    });

    await this.emailAdapter.sendOtpEmail({
      userId: user.id,
      email: user.email,
      otpCode,
      expiresInSeconds: EMAIL_VERIFICATION_TTL_SECONDS,
      purpose: 'EMAIL_VERIFICATION',
      verificationToken: linkToken,
    });

    const maskedTarget = this.maskEmail(user.email);
    this.logger.log(`Issued email verification for user ${user.id} (${maskedTarget})`);

    const isProd = this.configService?.app.env === 'production';
    return {
      sent: true,
      channel: 'EMAIL',
      maskedTarget,
      expiresInSeconds: EMAIL_VERIFICATION_TTL_SECONDS,
      sendCount,
      maxSends: policy.maxSends,
      cooldownSeconds: policy.cooldownSeconds,
      ...(!isProd
        ? {
            devVerificationCode: otpCode,
            devVerificationToken: linkToken,
          }
        : {}),
    };
  }

  /** Xác nhận Email bằng link token hoặc mã xác minh 6 số (Mục 3.2.6) */
  public async confirmEmailVerification(
    dto: ConfirmEmailVerificationRequest,
    authenticatedUserId?: number,
  ): Promise<VerificationConfirmResponse> {
    const candidateHash = this.passwordHasher.sha256(dto.tokenOrCode.trim());
    let record: AuthVerificationCodeEntity | null = null;

    if (authenticatedUserId || dto.email) {
      const user = await this.resolveTargetUser(authenticatedUserId, dto.email);
      if (user) {
        record = await this.findLatestUnverified(
          user.id,
          VERIFICATION_CHANNEL.EMAIL,
          VERIFICATION_PURPOSE.VERIFY_EMAIL,
        );
      }
    }

    if (!record) {
      record = await this.findByCandidateHash(candidateHash, VERIFICATION_CHANNEL.EMAIL);
    }

    if (!record || record.verifiedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestAppException('auth.invalidOrExpiredVerificationCode');
    }

    if (record.attemptCount >= record.maxAttempts) {
      throw new ForbiddenAppException('auth.otpMaxAttemptsExceeded', [
        { attemptCount: record.attemptCount, maxAttempts: record.maxAttempts },
      ]);
    }

    const validHashes = record.codeHash.split(':');
    if (!validHashes.includes(candidateHash)) {
      record.attemptCount += 1;
      if (record.attemptCount >= record.maxAttempts) {
        record.expiresAt = new Date(0);
        await this.saveVerificationRecord(record, record);
        throw new ForbiddenAppException('auth.otpMaxAttemptsExceeded', [
          { attemptCount: record.attemptCount, maxAttempts: record.maxAttempts },
        ]);
      }
      await this.saveVerificationRecord(record, record);
      throw new BadRequestAppException('auth.invalidOrExpiredVerificationCode');
    }

    const verifiedAt = new Date();
    record.verifiedAt = verifiedAt;
    await this.saveVerificationRecord(record, record);
    await this.usersPublicService.markEmailVerified(Number(record.userId));

    return {
      verified: true,
      channel: 'EMAIL',
      userId: Number(record.userId),
      verifiedAt: verifiedAt.toISOString(),
    };
  }

  /** Gửi mã OTP xác minh SĐT có giới hạn số lần gửi và thời gian chờ (Mục 3.2.7) */
  public async sendPhoneOtp(
    dto: SendPhoneOtpVerificationRequest,
    options: { userId?: number | undefined; ipAddress?: string | null | undefined } = {},
  ): Promise<VerificationSendResponse> {
    const normalizedPhone = normalizePhoneNumber(dto.phone);
    const user = await this.resolveTargetUser(options.userId, normalizedPhone ?? dto.phone);
    const targetPhone = normalizedPhone ?? normalizePhoneNumber(user?.phone);

    if (!user || !targetPhone) {
      throw new BadRequestAppException('auth.phoneNotFoundForVerification');
    }

    const policy = await this.getOtpPolicy();
    const existing = await this.findLatestUnverified(
      user.id,
      VERIFICATION_CHANNEL.PHONE_OTP,
      VERIFICATION_PURPOSE.VERIFY_PHONE,
    );

    const now = new Date();
    let sendCount = 1;

    if (existing) {
      const elapsedSec = (now.getTime() - existing.lastSentAt.getTime()) / 1000;
      if (policy.cooldownSeconds > 0 && elapsedSec < policy.cooldownSeconds) {
        throw new BadRequestAppException('auth.otpCooldownActive', [
          { retryAfterSeconds: Math.ceil(policy.cooldownSeconds - elapsedSec) },
        ]);
      }
      if (existing.sendCount >= policy.maxSends) {
        throw new ForbiddenAppException('auth.otpSendLimitExceeded', [
          { sendCount: existing.sendCount, maxSends: policy.maxSends },
        ]);
      }
      sendCount = existing.sendCount + 1;
    }

    const otpCode = this.passwordHasher.generateNumericOtp(6);
    const codeHash = this.passwordHasher.sha256(otpCode);
    const expiresAt = new Date(now.getTime() + PHONE_OTP_TTL_SECONDS * 1000);

    await this.saveVerificationRecord(existing, {
      userId: user.id,
      channel: VERIFICATION_CHANNEL.PHONE_OTP,
      purpose: VERIFICATION_PURPOSE.VERIFY_PHONE,
      target: targetPhone,
      codeHash,
      attemptCount: 0,
      maxAttempts: policy.maxAttempts,
      sendCount,
      maxSends: policy.maxSends,
      lastSentAt: now,
      expiresAt,
      verifiedAt: null,
      requestedIp: options.ipAddress ?? null,
    });

    await this.smsProvider.sendOtpSms({
      userId: user.id,
      phone: targetPhone,
      otpCode,
      expiresInSeconds: PHONE_OTP_TTL_SECONDS,
      purpose: 'PHONE_VERIFICATION',
    });

    const maskedTarget = this.maskPhone(targetPhone);
    this.logger.log(`Issued Phone OTP for user ${user.id} (${maskedTarget})`);

    const isProd = this.configService?.app.env === 'production';
    return {
      sent: true,
      channel: 'PHONE_OTP',
      maskedTarget,
      expiresInSeconds: PHONE_OTP_TTL_SECONDS,
      sendCount,
      maxSends: policy.maxSends,
      cooldownSeconds: policy.cooldownSeconds,
      ...(!isProd ? { devVerificationCode: otpCode } : {}),
    };
  }

  /** Xác minh SĐT bằng mã OTP 6 số có giới hạn số lần nhập sai (Mục 3.2.7) */
  public async confirmPhoneOtp(
    dto: ConfirmPhoneOtpVerificationRequest,
    authenticatedUserId?: number,
  ): Promise<VerificationConfirmResponse> {
    const normalizedPhone = normalizePhoneNumber(dto.phone);
    const user = await this.resolveTargetUser(authenticatedUserId, normalizedPhone ?? dto.phone);
    if (!user) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const record = await this.findLatestUnverified(
      user.id,
      VERIFICATION_CHANNEL.PHONE_OTP,
      VERIFICATION_PURPOSE.VERIFY_PHONE,
    );

    if (!record || record.verifiedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestAppException('auth.invalidOrExpiredOtpCode');
    }

    if (record.attemptCount >= record.maxAttempts) {
      throw new ForbiddenAppException('auth.otpMaxAttemptsExceeded', [
        { attemptCount: record.attemptCount, maxAttempts: record.maxAttempts },
      ]);
    }

    const candidateHash = this.passwordHasher.sha256(dto.code.trim());
    if (record.codeHash !== candidateHash) {
      record.attemptCount += 1;
      if (record.attemptCount >= record.maxAttempts) {
        record.expiresAt = new Date(0);
        await this.saveVerificationRecord(record, record);
        throw new ForbiddenAppException('auth.otpMaxAttemptsExceeded', [
          { attemptCount: record.attemptCount, maxAttempts: record.maxAttempts },
        ]);
      }
      await this.saveVerificationRecord(record, record);
      throw new BadRequestAppException('auth.invalidOrExpiredOtpCode');
    }

    const verifiedAt = new Date();
    record.verifiedAt = verifiedAt;
    await this.saveVerificationRecord(record, record);
    await this.usersPublicService.markPhoneVerified(user.id);

    return {
      verified: true,
      channel: 'PHONE_OTP',
      userId: user.id,
      verifiedAt: verifiedAt.toISOString(),
    };
  }

  private async resolveTargetUser(
    userId?: number,
    identifier?: string | null,
  ): Promise<{ id: number; email: string; phone: string | null } | null> {
    if (userId) {
      const byId = await this.usersPublicService.findAuthUserById(userId);
      if (byId) {
        return { id: byId.id, email: byId.email, phone: byId.phone };
      }
    }
    if (identifier && identifier.trim()) {
      const byIdent = await this.usersPublicService.findAuthUserByIdentifier(identifier.trim());
      if (byIdent) {
        return { id: byIdent.id, email: byIdent.email, phone: byIdent.phone };
      }
    }
    return null;
  }

  private async getOtpPolicy(): Promise<{
    maxSends: number;
    maxAttempts: number;
    cooldownSeconds: number;
  }> {
    const settings = await this.securitySettingsService?.getSettings();
    return {
      maxSends: settings?.otpMaxSendCount ?? DEFAULT_OTP_MAX_SENDS,
      maxAttempts: settings?.otpMaxAttempts ?? DEFAULT_OTP_MAX_ATTEMPTS,
      cooldownSeconds: settings?.otpCooldownSeconds ?? DEFAULT_OTP_COOLDOWN_SECONDS,
    };
  }

  private async findLatestUnverified(
    userId: number,
    channel: VerificationChannelCode,
    purpose: VerificationPurposeCode,
  ): Promise<AuthVerificationCodeEntity | null> {
    if (this.verificationRepo && typeof this.verificationRepo.findLatestUnverified === 'function') {
      try {
        const found = await this.verificationRepo.findLatestUnverified(userId, channel, purpose);
        if (found) return found;
      } catch {
        // Fallback sang bộ nhớ đệm nếu không chạy DB
      }
    }

    const matches = [...this.fallbackStore.values()]
      .filter(
        (r) =>
          Number(r.userId) === Number(userId) &&
          r.channel === channel &&
          r.purpose === purpose &&
          !r.verifiedAt,
      )
      .sort((a, b) => Number(b.id) - Number(a.id));
    return matches[0] ?? null;
  }

  private async findByCandidateHash(
    candidateHash: string,
    channel: VerificationChannelCode,
  ): Promise<AuthVerificationCodeEntity | null> {
    if (this.verificationRepo && typeof this.verificationRepo.findByCodeHash === 'function') {
      try {
        const found = await this.verificationRepo.findByCodeHash(candidateHash, channel);
        if (found) return found;
      } catch {
        // Fallback sang in-memory
      }
    }

    const matches = [...this.fallbackStore.values()]
      .filter(
        (r) =>
          r.channel === channel && !r.verifiedAt && r.codeHash.split(':').includes(candidateHash),
      )
      .sort((a, b) => Number(b.id) - Number(a.id));
    return matches[0] ?? null;
  }

  private async saveVerificationRecord(
    existing: AuthVerificationCodeEntity | null,
    data: Partial<AuthVerificationCodeEntity>,
  ): Promise<AuthVerificationCodeEntity> {
    const now = new Date();
    const record: AuthVerificationCodeEntity = {
      id: existing?.id ?? ++this.fallbackSeq,
      userId: Number(data.userId ?? existing?.userId ?? 0),
      channel: data.channel ?? existing?.channel ?? VERIFICATION_CHANNEL.EMAIL,
      purpose: data.purpose ?? existing?.purpose ?? VERIFICATION_PURPOSE.VERIFY_EMAIL,
      target: data.target ?? existing?.target ?? '',
      codeHash: data.codeHash ?? existing?.codeHash ?? '',
      attemptCount: data.attemptCount ?? existing?.attemptCount ?? 0,
      maxAttempts: data.maxAttempts ?? existing?.maxAttempts ?? DEFAULT_OTP_MAX_ATTEMPTS,
      sendCount: data.sendCount ?? existing?.sendCount ?? 1,
      maxSends: data.maxSends ?? existing?.maxSends ?? DEFAULT_OTP_MAX_SENDS,
      lastSentAt: data.lastSentAt ?? existing?.lastSentAt ?? now,
      expiresAt: data.expiresAt ?? existing?.expiresAt ?? now,
      verifiedAt: data.verifiedAt !== undefined ? data.verifiedAt : (existing?.verifiedAt ?? null),
      requestedIp:
        data.requestedIp !== undefined ? data.requestedIp : (existing?.requestedIp ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    } as AuthVerificationCodeEntity;

    this.fallbackStore.set(Number(record.id), record);

    if (this.verificationRepo && typeof this.verificationRepo.saveEntity === 'function') {
      try {
        const persisted = await this.verificationRepo.saveEntity(record);
        this.fallbackStore.set(Number(persisted.id), persisted);
        return persisted;
      } catch {
        // Fallback in-memory
      }
    }

    return record;
  }

  public maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return '***';
    const visible = localPart.slice(0, Math.min(2, localPart.length));
    return `${visible}***@${domain}`;
  }

  public maskPhone(phone: string): string {
    const cleaned = phone.trim();
    if (cleaned.length <= 4) return '***';
    return `${cleaned.slice(0, 3)}****${cleaned.slice(-3)}`;
  }
}

