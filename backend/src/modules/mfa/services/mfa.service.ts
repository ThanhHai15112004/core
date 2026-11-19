import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BaseCacheProvider } from '@packages/cache/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BadRequestAppException,
  SettingRegistryService,
  UnauthorizedAppException,
  defaultSettingRegistry,
  maskEmail as sharedMaskEmail,
  maskPhone as sharedMaskPhone,
} from '@packages/kernel/index.js';
import {
  FieldEncryptionService,
  PasswordHasherService,
  TokenService,
  TotpService,
  defaultFieldEncryptionService,
} from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  type UserAuthIdentityView,
  normalizePhoneNumber,
} from '@modules/users/contracts/index.js';
import { AUTH_EVENT_STATUS, SessionService } from '@modules/sessions/index.js';
import {
  AUTH_EMAIL_NOTIFICATION_ADAPTER,
  AUTH_SMS_OTP_PROVIDER,
  type IEmailNotificationAdapter,
  type ISmsOtpProvider,
  SecuritySettingsService,
  createDefaultEmailNotificationAdapter,
  createDefaultSmsOtpProvider,
} from '@modules/credentials/index.js';
import {
  type AdminResetMfaInput,
  type AdminResetMfaResponse,
  type AdminResetMfaResult,
  DEFAULT_MFA_OTP_MAX_ATTEMPTS,
  DEFAULT_RECOVERY_CODE_COUNT,
  EMAIL_OTP_TTL_SECONDS,
  type IMfaPublicService,
  MFA_METHOD,
  type MfaEnableResultResponse,
  type MfaExtendedEnvelope,
  type MfaMethodType,
  type MfaStatusResponse,
  type MfaTotpSetupResponse,
  SMS_OTP_TTL_SECONDS,
  type SendEmailOtpResponse,
  type SendSmsOtpResponse,
  type TrustedDeviceItemResponse,
} from '../contracts/index.js';
import type { AuthMfaConfigEntity } from '../entities/auth-mfa-config.entity.js';
import { MfaChallengeAttemptTracker } from '../helpers/mfa-challenge-attempt.helper.js';
import {
  normalizeRecoveryCode as normalizeRecoveryCodeHelper,
  parseExtendedMfaEnvelope,
  serializeExtendedMfaEnvelope,
} from '../helpers/mfa-envelope.helper.js';
import { AuthMfaConfigRepository } from '../repositories/auth-mfa-config.repository.js';
import type {
  DisableMfaRequest,
  EnableEmailOtpMfaRequest,
  EnableSmsOtpMfaRequest,
  EnableTotpMfaRequest,
  SendEmailOtpRequest,
  SendSmsOtpRequest,
  VerifyMfaChallengeRequest,
} from '../requests/mfa.requests.js';
import { MfaLifecycleService, type MfaSecurityEventDelegate } from './mfa-lifecycle.service.js';

export type { StoredTrustedDeviceRecord } from '../types/mfa.types.js';

@Injectable()
export class MfaService implements IMfaPublicService {
  private readonly logger = new Logger(MfaService.name);
  private readonly emailAdapter: IEmailNotificationAdapter;
  private readonly smsProvider: ISmsOtpProvider;
  private readonly settingRegistry: SettingRegistryService;
  private readonly mfaAttemptTracker: MfaChallengeAttemptTracker;
  private readonly lifecycleService: MfaLifecycleService;
  private securityEventDelegate?: MfaSecurityEventDelegate;

  constructor(
    private readonly mfaRepository: AuthMfaConfigRepository,
    private readonly totpService: TotpService,
    private readonly passwordHasher: PasswordHasherService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly configService?: CoreConfigService,
    @Optional()
    private readonly fieldEncryption: FieldEncryptionService = defaultFieldEncryptionService,
    @Optional()
    @Inject(AUTH_EMAIL_NOTIFICATION_ADAPTER)
    emailAdapter?: IEmailNotificationAdapter,
    @Optional()
    @Inject(AUTH_SMS_OTP_PROVIDER)
    smsProvider?: ISmsOtpProvider,
    @Optional() private readonly securitySettingsService?: SecuritySettingsService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly tokenService?: TokenService,
    @Optional() private readonly sessionService?: SessionService,
    @Optional() private readonly cacheProvider?: BaseCacheProvider | null,
    @Optional() lifecycleService?: MfaLifecycleService,
  ) {
    this.emailAdapter = emailAdapter ?? createDefaultEmailNotificationAdapter();
    this.smsProvider = smsProvider ?? createDefaultSmsOtpProvider();
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.mfaAttemptTracker = new MfaChallengeAttemptTracker(
      () => this.cacheProvider,
      this.settingRegistry,
    );
    this.lifecycleService =
      lifecycleService ??
      new MfaLifecycleService(
        this.mfaRepository,
        this.totpService,
        this.passwordHasher,
        this.usersPublicService,
        this.securitySettingsService,
        this.settingRegistry,
        this.tokenService,
        this.sessionService,
      );
    if (this.sessionService) {
      this.securityEventDelegate = (evt) =>
        this.sessionService!.recordAuthEvent({
          userId: evt.userId,
          actorId: evt.actorId ?? evt.userId,
          eventType: evt.eventType,
          status: AUTH_EVENT_STATUS.SUCCESS,
          reason: evt.reason,
          metadata: evt.metadata ?? null,
        });
    }
  }

  private getEmailOtpTtlSeconds(): number {
    return Math.max(
      30,
      this.settingRegistry.getNumber(
        'security.mfa.email_otp_ttl_seconds',
        undefined,
        EMAIL_OTP_TTL_SECONDS,
      ),
    );
  }

  public async getChallengeAttempts(challengeHash: string): Promise<number> {
    return this.mfaAttemptTracker.getAttempts(challengeHash);
  }

  public async incrementChallengeAttempts(
    challengeHash: string,
    currentAttempts: number,
  ): Promise<number> {
    return this.mfaAttemptTracker.incrementAttempts(challengeHash, currentAttempts);
  }

  public async clearChallengeAttempts(challengeHash: string): Promise<void> {
    await this.mfaAttemptTracker.clearAttempts(challengeHash);
  }

  private getSmsOtpTtlSeconds(): number {
    return Math.max(
      30,
      this.settingRegistry.getNumber(
        'security.mfa.sms_otp_ttl_seconds',
        undefined,
        SMS_OTP_TTL_SECONDS,
      ),
    );
  }

  private getRecoveryCodeCount(): number {
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

  private async getMaxOtpAttempts(): Promise<number> {
    const settings = await this.securitySettingsService?.getSettings();
    if (settings?.otpMaxAttempts && settings.otpMaxAttempts > 0) {
      return settings.otpMaxAttempts;
    }
    return Math.max(
      1,
      this.settingRegistry.getNumber(
        'security.otp.max_attempts',
        undefined,
        DEFAULT_MFA_OTP_MAX_ATTEMPTS,
      ),
    );
  }

  /** Đăng ký callback ghi nhận sự kiện bảo mật MFA (Tắt MFA / Reset MFA) vào lịch sử đăng nhập & Audit Log */
  public registerSecurityEventDelegate(
    delegate: (event: {
      userId: number;
      actorId?: number | null;
      eventType: 10 | 11;
      reason: string;
      metadata?: Record<string, unknown>;
    }) => Promise<unknown>,
  ): void {
    this.securityEventDelegate = delegate;
  }

  /** Lấy trạng thái cấu hình MFA hiện tại của người dùng */
  public async getStatus(userId: number): Promise<MfaStatusResponse> {
    return this.lifecycleService.getStatus(userId);
  }

  /** Lấy danh sách các phương thức MFA đang khả dụng cho người dùng khi đăng nhập bước 2 */
  public async getAvailableMethodsForUser(userId: number): Promise<MfaMethodType[]> {
    return this.lifecycleService.getAvailableMethodsForUser(userId);
  }

  /** Bước 1 thiết lập TOTP: sinh khóa bí mật Base32, mã hóa AEAD xuống DB và tạo đường dẫn otpauth:// */
  public async setupTotp(userId: number): Promise<MfaTotpSetupResponse> {
    const user = await this.usersPublicService.findAuthUserById(userId);
    if (!user) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const secret = this.totpService.generateSecret();
    const encryptedSecret = this.fieldEncryption.encrypt(secret);
    const issuer = this.configService?.app.name ?? 'CorePlatform';
    const otpauthUri = this.totpService.buildOtpAuthUri({
      secret,
      accountName: user.email,
      issuer,
    });

    let config = await this.findConfigByUserId(userId);
    if (!config) {
      config = await this.saveConfig({
        userId,
        totpSecret: encryptedSecret,
        totpEnabled: false,
        emailOtpEnabled: false,
        preferredMethod: MFA_METHOD.TOTP,
        recoveryCodesHashJson: '[]',
      });
    } else {
      config.totpSecret = encryptedSecret;
      await this.saveConfig(config);
    }

    return {
      secret,
      otpauthUri,
      otpauthUrl: otpauthUri,
      accountName: user.email,
      issuer,
    };
  }

  /** Bước 2 kích hoạt TOTP: giải mã khóa từ DB, xác minh mã 6 số từ ứng dụng Authenticator và cấp mã dự phòng */
  public async enableTotp(
    userId: number,
    dto: EnableTotpMfaRequest,
  ): Promise<MfaEnableResultResponse> {
    const config = await this.findConfigByUserId(userId);
    if (!config || !config.totpSecret) {
      throw new BadRequestAppException('auth.mfaTotpNotSetup');
    }

    const plainSecret = this.fieldEncryption.decrypt(config.totpSecret);
    const isValid = this.totpService.verifyCode(plainSecret, dto.code);
    if (!isValid) {
      throw new BadRequestAppException('auth.invalidMfaCode');
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const { plainCodes, hashesJson } = this.ensureRecoveryCodes(config);
    config.totpEnabled = true;
    config.preferredMethod = MFA_METHOD.TOTP;
    config.recoveryCodesHashJson = hashesJson;
    config.verifiedAt = new Date();

    await this.saveConfig(config);
    await this.usersPublicService.setMfaEnabled(userId, true);

    return {
      mfaEnabled: true,
      totpEnabled: true,
      emailOtpEnabled: Boolean(config.emailOtpEnabled),
      smsOtpEnabled: Boolean(envelope.smsOtpEnabled),
      recoveryCodes: plainCodes,
    };
  }

  /** Kích hoạt (hoặc tắt nếu `enabled: false`) phương thức xác thực nhiều lớp qua Email OTP (6 chữ số) */
  public async enableEmailOtp(
    userId: number,
    dto: EnableEmailOtpMfaRequest = {},
  ): Promise<MfaEnableResultResponse> {
    if (dto.enabled === false) {
      const status = await this.disableMfa(userId, {
        method: 'EMAIL_OTP',
        ...(dto.code ? { code: dto.code } : {}),
      });
      return {
        mfaEnabled: status.mfaEnabled,
        totpEnabled: status.totpEnabled,
        emailOtpEnabled: status.emailOtpEnabled,
        smsOtpEnabled: Boolean(status.smsOtpEnabled),
        recoveryCodes: [],
      };
    }

    let config = await this.findConfigByUserId(userId);
    if (!config) {
      config = await this.saveConfig({
        userId,
        totpSecret: null,
        totpEnabled: false,
        emailOtpEnabled: false,
        preferredMethod: MFA_METHOD.EMAIL_OTP,
        recoveryCodesHashJson: '[]',
      });
    }

    if (dto.code) {
      const validOtp = await this.verifyAndTrackEmailOtp(config, dto.code);
      if (!validOtp) {
        throw new BadRequestAppException('auth.invalidMfaCode');
      }
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
      config.emailOtpFailedAttempts = 0;
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const { plainCodes, hashesJson } = this.ensureRecoveryCodes(config);
    config.emailOtpEnabled = true;
    if (!config.totpEnabled) {
      config.preferredMethod = MFA_METHOD.EMAIL_OTP;
    }
    config.recoveryCodesHashJson = hashesJson;
    config.verifiedAt = new Date();

    await this.saveConfig(config);
    await this.usersPublicService.setMfaEnabled(userId, true);

    return {
      mfaEnabled: true,
      totpEnabled: Boolean(config.totpEnabled),
      emailOtpEnabled: true,
      smsOtpEnabled: Boolean(envelope.smsOtpEnabled),
      recoveryCodes: plainCodes,
    };
  }

  /** Kích hoạt (hoặc tắt nếu `enabled: false`) phương thức xác thực nhiều lớp qua SMS OTP (Mục 3.5.2) */
  public async enableSmsOtp(
    userId: number,
    dto: EnableSmsOtpMfaRequest = {},
  ): Promise<MfaEnableResultResponse> {
    if (dto.enabled === false) {
      const status = await this.disableMfa(userId, {
        method: 'SMS_OTP',
        ...(dto.code ? { code: dto.code } : {}),
      });
      return {
        mfaEnabled: status.mfaEnabled,
        totpEnabled: status.totpEnabled,
        emailOtpEnabled: status.emailOtpEnabled,
        smsOtpEnabled: Boolean(status.smsOtpEnabled),
        recoveryCodes: [],
      };
    }

    const user = await this.usersPublicService.findAuthUserById(userId);
    if (!user || !user.phone) {
      throw new BadRequestAppException('auth.phoneRequiredForSmsMfa');
    }

    let config = await this.findConfigByUserId(userId);
    if (!config) {
      config = await this.saveConfig({
        userId,
        totpSecret: null,
        totpEnabled: false,
        emailOtpEnabled: false,
        preferredMethod: MFA_METHOD.SMS_OTP,
        recoveryCodesHashJson: '[]',
      });
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);

    if (dto.code) {
      const validSms = await this.verifyAndTrackSmsOtp(config, envelope, dto.code);
      if (!validSms) {
        throw new BadRequestAppException('auth.invalidMfaCode');
      }
      envelope.smsOtpCodeHash = null;
      envelope.smsOtpExpiresAt = null;
      envelope.smsOtpFailedAttempts = 0;
    }

    let plainCodes: string[] = [];
    if (envelope.codes.length === 0) {
      plainCodes = this.totpService.generateRecoveryCodes(this.getRecoveryCodeCount());
      envelope.codes = plainCodes.map((c) =>
        this.passwordHasher.sha256(this.normalizeRecoveryCode(c)),
      );
    }

    envelope.smsOtpEnabled = true;
    if (!config.totpEnabled && !config.emailOtpEnabled) {
      config.preferredMethod = MFA_METHOD.SMS_OTP;
    }
    config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    config.verifiedAt = new Date();

    await this.saveConfig(config);
    await this.usersPublicService.setMfaEnabled(userId, true);

    return {
      mfaEnabled: true,
      totpEnabled: Boolean(config.totpEnabled),
      emailOtpEnabled: Boolean(config.emailOtpEnabled),
      smsOtpEnabled: true,
      recoveryCodes: plainCodes,
    };
  }

  /** Phát sinh và gửi mã OTP 6 chữ số qua Email thông qua Notification Adapter (Mục 3.5.1) */
  public async sendEmailOtp(userId: number): Promise<SendEmailOtpResponse> {
    const user = await this.usersPublicService.findAuthUserById(userId);
    if (!user) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const emailOtpTtlSeconds = this.getEmailOtpTtlSeconds();
    const otpCode = this.passwordHasher.generateNumericOtp(6);
    const otpHash = this.passwordHasher.sha256(otpCode);
    const expiresAt = new Date(Date.now() + emailOtpTtlSeconds * 1000);

    let config = await this.findConfigByUserId(userId);
    if (!config) {
      config = await this.saveConfig({
        userId,
        totpSecret: null,
        totpEnabled: false,
        emailOtpEnabled: false,
        preferredMethod: MFA_METHOD.EMAIL_OTP,
        recoveryCodesHashJson: '[]',
        emailOtpCodeHash: otpHash,
        emailOtpExpiresAt: expiresAt,
        emailOtpFailedAttempts: 0,
      });
    } else {
      config.emailOtpCodeHash = otpHash;
      config.emailOtpExpiresAt = expiresAt;
      config.emailOtpFailedAttempts = 0;
      await this.saveConfig(config);
    }

    const dispatchResult = await this.emailAdapter.sendOtpEmail({
      userId: user.id,
      email: user.email,
      otpCode,
      expiresInSeconds: emailOtpTtlSeconds,
      purpose: 'MFA_EMAIL_OTP',
    });

    const maskedEmail = this.maskEmail(user.email);
    this.logger.log(`Issued Email OTP for user ${user.id} (${maskedEmail})`);

    const isProd = this.configService?.app.env === 'production';
    return {
      sent: true,
      maskedEmail,
      expiresInSeconds: emailOtpTtlSeconds,
      ...(dispatchResult.messageId ? { messageId: dispatchResult.messageId } : {}),
      ...(!isProd ? { devOtpCode: otpCode } : {}),
    };
  }

  /** Phát sinh và gửi mã OTP 6 chữ số qua SMS thông qua SMS Provider riêng của dự án (Mục 3.5.2) */
  public async sendSmsOtp(userId: number, phoneOverride?: string): Promise<SendSmsOtpResponse> {
    const user = await this.usersPublicService.findAuthUserById(userId);
    if (!user) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const targetPhone = normalizePhoneNumber(phoneOverride ?? user.phone);
    if (!targetPhone) {
      throw new BadRequestAppException('auth.phoneRequiredForSmsMfa');
    }

    const smsOtpTtlSeconds = this.getSmsOtpTtlSeconds();
    const otpCode = this.passwordHasher.generateNumericOtp(6);
    const otpHash = this.passwordHasher.sha256(otpCode);
    const expiresAt = new Date(Date.now() + smsOtpTtlSeconds * 1000);

    let config = await this.findConfigByUserId(userId);
    if (!config) {
      config = await this.saveConfig({
        userId,
        totpSecret: null,
        totpEnabled: false,
        emailOtpEnabled: false,
        preferredMethod: MFA_METHOD.SMS_OTP,
        recoveryCodesHashJson: '[]',
      });
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    envelope.smsOtpCodeHash = otpHash;
    envelope.smsOtpExpiresAt = expiresAt.toISOString();
    envelope.smsOtpFailedAttempts = 0;
    config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    await this.saveConfig(config);

    const dispatchResult = await this.smsProvider.sendOtpSms({
      userId: user.id,
      phone: targetPhone,
      otpCode,
      expiresInSeconds: smsOtpTtlSeconds,
      purpose: 'MFA_SMS_OTP',
    });

    const maskedPhone = this.maskPhone(targetPhone);
    this.logger.log(`Issued SMS OTP for user ${user.id} (${maskedPhone})`);

    const isProd = this.configService?.app.env === 'production';
    return {
      sent: true,
      maskedPhone,
      expiresInSeconds: smsOtpTtlSeconds,
      ...(dispatchResult.providerMessageId
        ? { providerMessageId: dispatchResult.providerMessageId }
        : {}),
      ...(!isProd ? { devOtpCode: otpCode } : {}),
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
    return this.sendEmailOtp(targetUserId);
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
    return this.sendSmsOtp(targetUserId, dto?.phone);
  }

  /** Xác thực mã MFA/2FA bước 2 (TOTP, Email OTP, SMS OTP hoặc Recovery Code) để hoàn tất đăng nhập */
  public async verifyMfaChallenge(
    dto: VerifyMfaChallengeRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
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
    return this.lifecycleService.verifyMfaChallenge(
      dto,
      meta,
      this.mfaAttemptTracker,
      (userId, code, preferredMethod) => this.verifyMfaCode(userId, code, preferredMethod),
    );
  }

  /** Xác minh mã MFA bước 2 (hỗ trợ cả TOTP, Email OTP, SMS OTP và Recovery Code) */
  public async verifyMfaCode(
    userId: number,
    code: string,
    preferredMethod?: MfaMethodType,
  ): Promise<boolean> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return false;
    }

    const trimmedCode = code.trim();
    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);

    // 1. Kiểm tra nếu người dùng truyền mã khôi phục dự phòng (Recovery Code)
    if (preferredMethod === 'RECOVERY_CODE' || trimmedCode.includes('-')) {
      if (await this.consumeRecoveryCode(config, trimmedCode)) {
        return true;
      }
      if (preferredMethod === 'RECOVERY_CODE') {
        return false;
      }
    }

    // 2. Kiểm tra mã TOTP từ ứng dụng Google Authenticator
    if (
      (preferredMethod === 'TOTP' || !preferredMethod) &&
      config.totpEnabled &&
      config.totpSecret
    ) {
      const plainSecret = this.fieldEncryption.decrypt(config.totpSecret);
      if (this.totpService.verifyCode(plainSecret, trimmedCode)) {
        return true;
      }
      if (preferredMethod === 'TOTP') {
        return false;
      }
    }

    // 3. Kiểm tra mã Email OTP 6 chữ số (kèm giới hạn số lần nhập sai)
    if (preferredMethod === 'EMAIL_OTP' || !preferredMethod) {
      if (await this.verifyAndTrackEmailOtp(config, trimmedCode)) {
        config.emailOtpCodeHash = null;
        config.emailOtpExpiresAt = null;
        config.emailOtpFailedAttempts = 0;
        await this.saveConfig(config);
        return true;
      }
      if (preferredMethod === 'EMAIL_OTP') {
        return false;
      }
    }

    // 4. Kiểm tra mã SMS OTP 6 chữ số (Mục 3.5.2)
    if (preferredMethod === 'SMS_OTP' || !preferredMethod) {
      if (await this.verifyAndTrackSmsOtp(config, envelope, trimmedCode)) {
        envelope.smsOtpCodeHash = null;
        envelope.smsOtpExpiresAt = null;
        envelope.smsOtpFailedAttempts = 0;
        config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
        await this.saveConfig(config);
        return true;
      }
      if (preferredMethod === 'SMS_OTP') {
        return false;
      }
    }

    // 5. Fallback kiểm tra Recovery Code không có dấu gạch ngang
    if (!preferredMethod && (await this.consumeRecoveryCode(config, trimmedCode))) {
      return true;
    }

    return false;
  }

  /**
   * Đăng ký thiết bị hiện tại vào danh sách Thiết bị tin cậy (Trusted Devices — Mục 3.5.5)
   */
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
    return this.lifecycleService.registerTrustedDevice(userId, options);
  }

  /**
   * Kiểm tra token thiết bị tin cậy khi đăng nhập (Mục 3.5.5).
   */
  public async verifyTrustedDevice(
    userId: number,
    rawTrustedDeviceToken?: string | null,
  ): Promise<boolean> {
    return this.lifecycleService.verifyTrustedDevice(userId, rawTrustedDeviceToken);
  }

  /** Danh sách các thiết bị tin cậy đang còn hiệu lực của người dùng (Mục 3.5.5) */
  public async listTrustedDevices(userId: number): Promise<TrustedDeviceItemResponse[]> {
    return this.lifecycleService.listTrustedDevices(userId);
  }

  /** Thu hồi một thiết bị tin cậy cụ thể theo deviceId (Mục 3.5.5) */
  public async revokeTrustedDevice(
    userId: number,
    deviceId: string,
  ): Promise<{ revoked: true; deviceId: string }> {
    return this.lifecycleService.revokeTrustedDevice(userId, deviceId);
  }

  /** Thu hồi toàn bộ thiết bị tin cậy của người dùng (Mục 3.5.5) */
  public async revokeAllTrustedDevices(
    userId: number,
  ): Promise<{ revoked: true; revokedCount: number }> {
    return this.lifecycleService.revokeAllTrustedDevices(userId);
  }

  /**
   * Reset MFA có kiểm soát từ trang quản trị (Mục 3.5.8 — Có xác minh hoặc phê duyệt)
   */
  public async adminResetUserMfa(
    userId: number,
    input: AdminResetMfaInput,
    actorId?: number,
    revokeSessionsCallback?: (userId: number, reason: string) => Promise<number>,
  ): Promise<AdminResetMfaResult & AdminResetMfaResponse> {
    return this.lifecycleService.adminResetUserMfa(
      userId,
      input,
      actorId,
      revokeSessionsCallback,
      this.securityEventDelegate,
    );
  }

  /** Tắt xác thực nhiều lớp (TOTP, Email OTP, SMS OTP hoặc toàn bộ) */
  public async disableMfa(userId: number, dto: DisableMfaRequest): Promise<MfaStatusResponse> {
    return this.lifecycleService.disableMfa(
      userId,
      dto,
      (uid, code) => this.verifyMfaCode(uid, code),
      this.securityEventDelegate,
    );
  }

  /** Cấp lại bộ 8 mã khôi phục dự phòng (Recovery Codes) mới */
  public async regenerateRecoveryCodes(userId: number): Promise<{ recoveryCodes: string[] }> {
    return this.lifecycleService.regenerateRecoveryCodes(userId);
  }

  private async resolveMfaTargetUserId(
    authenticatedUserId?: number,
    mfaChallengeToken?: string,
  ): Promise<number> {
    let targetUserId = authenticatedUserId;
    if (!targetUserId && mfaChallengeToken && this.tokenService) {
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

  /** Kiểm tra mã Email OTP đã lưu, thời hạn hiệu lực và giới hạn số lần nhập sai (tối đa theo otpMaxAttempts) */
  private async verifyAndTrackEmailOtp(
    config: AuthMfaConfigEntity,
    code: string,
  ): Promise<boolean> {
    if (!config.emailOtpCodeHash || !config.emailOtpExpiresAt) {
      return false;
    }
    if (config.emailOtpExpiresAt.getTime() <= Date.now()) {
      return false;
    }
    const maxAttempts = await this.getMaxOtpAttempts();
    const currentFailed = config.emailOtpFailedAttempts ?? 0;
    if (currentFailed >= maxAttempts) {
      return false;
    }
    const candidateHash = this.passwordHasher.sha256(code.trim());
    if (this.passwordHasher.safeEqualHex(candidateHash, config.emailOtpCodeHash)) {
      return true;
    }
    config.emailOtpFailedAttempts = currentFailed + 1;
    if (config.emailOtpFailedAttempts >= maxAttempts) {
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
    }
    await this.saveConfig(config);
    return false;
  }

  /** Kiểm tra mã SMS OTP đã lưu, thời hạn hiệu lực và giới hạn số lần nhập sai (tối đa theo otpMaxAttempts) */
  private async verifyAndTrackSmsOtp(
    config: AuthMfaConfigEntity,
    envelope: MfaExtendedEnvelope,
    code: string,
  ): Promise<boolean> {
    if (!envelope.smsOtpCodeHash || !envelope.smsOtpExpiresAt) {
      return false;
    }
    const expiresAtMs = new Date(envelope.smsOtpExpiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return false;
    }
    const maxAttempts = await this.getMaxOtpAttempts();
    const currentFailed = envelope.smsOtpFailedAttempts ?? 0;
    if (currentFailed >= maxAttempts) {
      return false;
    }
    const candidateHash = this.passwordHasher.sha256(code.trim());
    if (this.passwordHasher.safeEqualHex(candidateHash, envelope.smsOtpCodeHash)) {
      return true;
    }
    envelope.smsOtpFailedAttempts = currentFailed + 1;
    if (envelope.smsOtpFailedAttempts >= maxAttempts) {
      envelope.smsOtpCodeHash = null;
      envelope.smsOtpExpiresAt = null;
    }
    config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    await this.saveConfig(config);
    return false;
  }

  /** Kiểm tra và gạch bỏ mã khôi phục dự phòng đã sử dụng */
  private async consumeRecoveryCode(
    config: AuthMfaConfigEntity,
    rawCode: string,
  ): Promise<boolean> {
    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    if (envelope.codes.length === 0) return false;

    const candidateHash = this.passwordHasher.sha256(this.normalizeRecoveryCode(rawCode));
    const idx = envelope.codes.findIndex((stored) =>
      this.passwordHasher.safeEqualHex(stored, candidateHash),
    );
    if (idx === -1) {
      return false;
    }

    envelope.codes.splice(idx, 1);
    config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    await this.saveConfig(config);
    return true;
  }

  /** Sinh bộ mã khôi phục mới cho người dùng khi kích hoạt MFA lần đầu (giữ nguyên nếu đã có) */
  private ensureRecoveryCodes(config: AuthMfaConfigEntity): {
    plainCodes: string[];
    hashesJson: string;
  } {
    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    if (envelope.codes.length > 0 && config.recoveryCodesHashJson) {
      return {
        plainCodes: [],
        hashesJson: this.serializeExtendedEnvelope(envelope),
      };
    }
    const plainCodes = this.totpService.generateRecoveryCodes(this.getRecoveryCodeCount());
    envelope.codes = plainCodes.map((c) =>
      this.passwordHasher.sha256(this.normalizeRecoveryCode(c)),
    );
    return {
      plainCodes,
      hashesJson: this.serializeExtendedEnvelope(envelope),
    };
  }

  /** Giải mã cấu trúc JSON mở rộng (tương thích ngược với mảng string[] cũ) */
  private parseExtendedEnvelope(jsonStr?: string | null): MfaExtendedEnvelope {
    return parseExtendedMfaEnvelope(jsonStr);
  }

  /** Tuần tự hóa lại JSON mở rộng (nếu không có metadata mở rộng thì xuất mảng thuần để giữ tương thích tối đa) */
  private serializeExtendedEnvelope(envelope: MfaExtendedEnvelope): string {
    return serializeExtendedMfaEnvelope(envelope);
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

  /** Chuẩn hóa mã khôi phục về chữ in hoa không dấu gạch ngang */
  private normalizeRecoveryCode(code: string): string {
    return normalizeRecoveryCodeHelper(code);
  }

  /** Che bớt địa chỉ email khi trả về thông báo gửi OTP (vd: ad***@gmail.com) */
  public maskEmail(email: string): string {
    return sharedMaskEmail(email);
  }

  /** Che bớt số điện thoại khi trả về thông báo gửi SMS OTP (vd: 090****456) */
  public maskPhone(phone: string): string {
    return sharedMaskPhone(phone);
  }
}
