import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BadRequestAppException,
  NotFoundAppException,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import {
  FieldEncryptionService,
  PasswordHasherService,
  TotpService,
} from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  normalizePhoneNumber,
} from '@modules/users/contracts/index.js';
import {
  AUTH_EMAIL_NOTIFICATION_ADAPTER,
  AUTH_SMS_OTP_PROVIDER,
  type AdminResetMfaInput,
  type AdminResetMfaResult,
  type IEmailNotificationAdapter,
  type ISmsOtpProvider,
  MFA_METHOD,
  MFA_METHOD_NAME,
  type MfaMethodType,
} from '../contracts/index.js';
import type { AuthMfaConfigEntity } from '../entities/auth-mfa-config.entity.js';
import { AuthMfaConfigRepository } from '../repositories/auth-mfa-config.repository.js';
import {
  DefaultEmailNotificationAdapter,
  DefaultSmsOtpProvider,
} from './notification-adapters.provider.js';
import type {
  DisableMfaRequest,
  EnableEmailOtpMfaRequest,
  EnableSmsOtpMfaRequest,
  EnableTotpMfaRequest,
} from '../requests/auth.requests.js';
import type {
  AdminResetMfaResponse,
  MfaEnableResultResponse,
  MfaStatusResponse,
  MfaTotpSetupResponse,
  SendEmailOtpResponse,
  SendSmsOtpResponse,
  TrustedDeviceItemResponse,
} from '../responses/auth.response.js';

const EMAIL_OTP_TTL_SECONDS = 300; // 5 phút
const SMS_OTP_TTL_SECONDS = 300; // 5 phút
const DEFAULT_TRUSTED_DEVICE_DAYS = 30;

export interface StoredTrustedDeviceRecord {
  readonly deviceId: string;
  readonly tokenHash: string;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  lastUsedAt: string;
  readonly trustedUntil: string;
}

interface MfaExtendedEnvelope {
  codes: string[];
  smsOtpEnabled?: boolean;
  smsOtpCodeHash?: string | null;
  smsOtpExpiresAt?: string | null;
  smsOtpFailedAttempts?: number;
  trustedDevices?: StoredTrustedDeviceRecord[];
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly emailAdapter: IEmailNotificationAdapter;
  private readonly smsProvider: ISmsOtpProvider;
  private securityEventDelegate?: (event: {
    userId: number;
    actorId?: number | null;
    eventType: 10 | 11;
    reason: string;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;

  constructor(
    private readonly mfaRepository: AuthMfaConfigRepository,
    private readonly totpService: TotpService,
    private readonly passwordHasher: PasswordHasherService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly configService?: CoreConfigService,
    @Optional()
    private readonly fieldEncryption: FieldEncryptionService = new FieldEncryptionService(),
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

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const activeTrustedDevices = this.filterActiveTrustedDevices(envelope.trustedDevices ?? []);
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

  /** Lấy danh sách các phương thức MFA đang khả dụng cho người dùng khi đăng nhập bước 2 */
  public async getAvailableMethodsForUser(userId: number): Promise<MfaMethodType[]> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return ['EMAIL_OTP'];
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
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
      plainCodes = this.totpService.generateRecoveryCodes(8);
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

    const otpCode = this.passwordHasher.generateNumericOtp(6);
    const otpHash = this.passwordHasher.sha256(otpCode);
    const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_SECONDS * 1000);

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
      expiresInSeconds: EMAIL_OTP_TTL_SECONDS,
      purpose: 'MFA_EMAIL_OTP',
    });

    const maskedEmail = this.maskEmail(user.email);
    this.logger.log(`Issued Email OTP for user ${user.id} (${maskedEmail})`);

    const isProd = this.configService?.app.env === 'production';
    return {
      sent: true,
      maskedEmail,
      expiresInSeconds: EMAIL_OTP_TTL_SECONDS,
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

    const otpCode = this.passwordHasher.generateNumericOtp(6);
    const otpHash = this.passwordHasher.sha256(otpCode);
    const expiresAt = new Date(Date.now() + SMS_OTP_TTL_SECONDS * 1000);

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
      expiresInSeconds: SMS_OTP_TTL_SECONDS,
      purpose: 'MFA_SMS_OTP',
    });

    const maskedPhone = this.maskPhone(targetPhone);
    this.logger.log(`Issued SMS OTP for user ${user.id} (${maskedPhone})`);

    const isProd = this.configService?.app.env === 'production';
    return {
      sent: true,
      maskedPhone,
      expiresInSeconds: SMS_OTP_TTL_SECONDS,
      ...(dispatchResult.providerMessageId
        ? { providerMessageId: dispatchResult.providerMessageId }
        : {}),
      ...(!isProd ? { devOtpCode: otpCode } : {}),
    };
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
   * Có thời hạn (`trustDurationDays`, mặc định 30 ngày) và có thể thu hồi bất kỳ lúc nào.
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

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const activeDevices = this.filterActiveTrustedDevices(envelope.trustedDevices ?? []);

    const deviceId = `td-${randomUUID()}`;
    const rawSecret = this.passwordHasher.generateRandomToken(24);
    const trustedDeviceToken = `${userId}.${deviceId}.${rawSecret}`;
    const tokenHash = this.passwordHasher.sha256(trustedDeviceToken);

    const days = Math.max(
      1,
      Math.min(365, options.trustDurationDays ?? DEFAULT_TRUSTED_DEVICE_DAYS),
    );
    const now = new Date();
    const trustedUntilDate = new Date(now.getTime() + days * 86_400_000);

    const record: StoredTrustedDeviceRecord = {
      deviceId,
      tokenHash,
      deviceName: options.deviceName ?? this.inferDeviceName(options.userAgent),
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ?? null,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      trustedUntil: trustedUntilDate.toISOString(),
    };

    envelope.trustedDevices = [record, ...activeDevices].slice(0, 20);
    config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    await this.saveConfig(config);

    return {
      deviceId,
      trustedDeviceToken,
      trustedUntil: record.trustedUntil,
      device: this.toTrustedDeviceResponse(record),
    };
  }

  /**
   * Kiểm tra token thiết bị tin cậy khi đăng nhập (Mục 3.5.5).
   * Tự động loại bỏ các thiết bị đã hết hạn.
   */
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

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const activeDevices = this.filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    if (activeDevices.length === 0) {
      return false;
    }

    const candidateHash = this.passwordHasher.sha256(rawTrustedDeviceToken.trim());
    const matched = activeDevices.find((d) => d.tokenHash === candidateHash);
    if (!matched) {
      return false;
    }

    matched.lastUsedAt = new Date().toISOString();
    envelope.trustedDevices = activeDevices;
    config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    await this.saveConfig(config);
    return true;
  }

  /** Danh sách các thiết bị tin cậy đang còn hiệu lực của người dùng (Mục 3.5.5) */
  public async listTrustedDevices(userId: number): Promise<TrustedDeviceItemResponse[]> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return [];
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const activeDevices = this.filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    return activeDevices.map((d) => this.toTrustedDeviceResponse(d));
  }

  /** Thu hồi một thiết bị tin cậy cụ thể theo deviceId (Mục 3.5.5) */
  public async revokeTrustedDevice(
    userId: number,
    deviceId: string,
  ): Promise<{ revoked: true; deviceId: string }> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      throw new NotFoundAppException('auth.trustedDeviceNotFound', { deviceId });
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const activeDevices = this.filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    const remaining = activeDevices.filter((d) => d.deviceId !== deviceId);

    if (remaining.length === activeDevices.length) {
      throw new NotFoundAppException('auth.trustedDeviceNotFound', { deviceId });
    }

    envelope.trustedDevices = remaining;
    config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    await this.saveConfig(config);

    return { revoked: true, deviceId };
  }

  /** Thu hồi toàn bộ thiết bị tin cậy của người dùng (Mục 3.5.5) */
  public async revokeAllTrustedDevices(
    userId: number,
  ): Promise<{ revoked: true; revokedCount: number }> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      return { revoked: true, revokedCount: 0 };
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const activeDevices = this.filterActiveTrustedDevices(envelope.trustedDevices ?? []);
    const revokedCount = activeDevices.length;

    envelope.trustedDevices = [];
    config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    await this.saveConfig(config);

    return { revoked: true, revokedCount };
  }

  /**
   * Reset MFA có kiểm soát từ trang quản trị (Mục 3.5.8 — Có xác minh hoặc phê duyệt)
   * Xóa toàn bộ cấu hình MFA (TOTP, Email OTP, SMS OTP, Recovery Codes, Trusted Devices) của người dùng.
   */
  public async adminResetUserMfa(
    userId: number,
    input: AdminResetMfaInput,
    actorId?: number,
    revokeSessionsCallback?: (userId: number, reason: string) => Promise<number>,
  ): Promise<AdminResetMfaResult & AdminResetMfaResponse> {
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
      const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
      revokedTrustedDevicesCount = this.filterActiveTrustedDevices(
        envelope.trustedDevices ?? [],
      ).length;

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
    if (input.revokeSessions !== false && revokeSessionsCallback) {
      const sessionReason = `MFA reset by administrator${actorId ? ` #${actorId}` : ''}: ${reason}`;
      revokedSessionsCount = await revokeSessionsCallback(userId, sessionReason);
    }

    const resetAt = new Date().toISOString();
    this.logger.log(
      `Controlled MFA reset executed for user #${userId} by actor #${actorId ?? 'system'} (reason="${reason}", ref="${input.verificationReference ?? 'N/A'}")`,
    );

    await this.securityEventDelegate?.({
      userId: Number(userId),
      actorId: actorId ?? null,
      eventType: 11, // AUTH_EVENT_TYPE.MFA_RESET
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

  /** Tắt xác thực nhiều lớp (TOTP, Email OTP, SMS OTP hoặc toàn bộ) */
  public async disableMfa(userId: number, dto: DisableMfaRequest): Promise<MfaStatusResponse> {
    const config = await this.findConfigByUserId(userId);
    if (!config) {
      await this.usersPublicService.setMfaEnabled(userId, false);
      await this.securityEventDelegate?.({
        userId: Number(userId),
        actorId: Number(userId),
        eventType: 10, // AUTH_EVENT_TYPE.MFA_DISABLED
        reason: `User disabled MFA (${dto.method ?? 'ALL'})`,
        metadata: { method: dto.method ?? 'ALL', mfaEnabledAfter: false },
      });
      return this.getStatus(userId);
    }

    if (dto.code) {
      const ok = await this.verifyMfaCode(userId, dto.code);
      if (!ok) {
        throw new BadRequestAppException('auth.invalidMfaCode');
      }
    }

    const envelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);

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
      config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    } else {
      config.totpEnabled = false;
      config.totpSecret = null;
      config.emailOtpEnabled = false;
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
      config.emailOtpFailedAttempts = 0;
      config.recoveryCodesHashJson = '[]';
    }

    const updatedEnvelope = this.parseExtendedEnvelope(config.recoveryCodesHashJson);
    const stillEnabled = Boolean(
      config.totpEnabled || config.emailOtpEnabled || updatedEnvelope.smsOtpEnabled,
    );
    await this.saveConfig(config);
    await this.usersPublicService.setMfaEnabled(userId, stillEnabled);

    await this.securityEventDelegate?.({
      userId: Number(userId),
      actorId: Number(userId),
      eventType: 10, // AUTH_EVENT_TYPE.MFA_DISABLED
      reason: `User disabled MFA (${dto.method ?? 'ALL'})`,
      metadata: { method: dto.method ?? 'ALL', mfaEnabledAfter: stillEnabled },
    });

    return this.getStatus(userId);
  }

  /** Cấp lại bộ 8 mã khôi phục dự phòng (Recovery Codes) mới */
  public async regenerateRecoveryCodes(userId: number): Promise<{ recoveryCodes: string[] }> {
    const config = await this.findConfigByUserId(userId);
    const envelope = config ? this.parseExtendedEnvelope(config.recoveryCodesHashJson) : null;
    if (!config || (!config.totpEnabled && !config.emailOtpEnabled && !envelope?.smsOtpEnabled)) {
      throw new BadRequestAppException('auth.mfaNotEnabled');
    }

    const plainCodes = this.totpService.generateRecoveryCodes(8);
    const hashes = plainCodes.map((c) => this.passwordHasher.sha256(this.normalizeRecoveryCode(c)));
    if (envelope) {
      envelope.codes = hashes;
      config.recoveryCodesHashJson = this.serializeExtendedEnvelope(envelope);
    } else {
      config.recoveryCodesHashJson = JSON.stringify(hashes);
    }
    await this.saveConfig(config);

    return { recoveryCodes: plainCodes };
  }

  /** Kiểm tra mã Email OTP đã lưu, thời hạn hiệu lực và giới hạn số lần nhập sai (tối đa 5 lần) */
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
    const currentFailed = config.emailOtpFailedAttempts ?? 0;
    if (currentFailed >= 5) {
      return false;
    }
    const candidateHash = this.passwordHasher.sha256(code.trim());
    if (candidateHash === config.emailOtpCodeHash) {
      return true;
    }
    config.emailOtpFailedAttempts = currentFailed + 1;
    if (config.emailOtpFailedAttempts >= 5) {
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
    }
    await this.saveConfig(config);
    return false;
  }

  /** Kiểm tra mã SMS OTP đã lưu, thời hạn hiệu lực và giới hạn số lần nhập sai (tối đa 5 lần) */
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
    const currentFailed = envelope.smsOtpFailedAttempts ?? 0;
    if (currentFailed >= 5) {
      return false;
    }
    const candidateHash = this.passwordHasher.sha256(code.trim());
    if (candidateHash === envelope.smsOtpCodeHash) {
      return true;
    }
    envelope.smsOtpFailedAttempts = currentFailed + 1;
    if (envelope.smsOtpFailedAttempts >= 5) {
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
    const idx = envelope.codes.indexOf(candidateHash);
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
    const plainCodes = this.totpService.generateRecoveryCodes(8);
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
    if (!jsonStr) {
      return { codes: [] };
    }
    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      if (Array.isArray(parsed)) {
        return {
          codes: parsed.filter((item): item is string => typeof item === 'string'),
        };
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Partial<MfaExtendedEnvelope>;
        return {
          codes: Array.isArray(obj.codes)
            ? obj.codes.filter((item): item is string => typeof item === 'string')
            : [],
          ...(obj.smsOtpEnabled !== undefined ? { smsOtpEnabled: Boolean(obj.smsOtpEnabled) } : {}),
          ...(obj.smsOtpCodeHash !== undefined ? { smsOtpCodeHash: obj.smsOtpCodeHash } : {}),
          ...(obj.smsOtpExpiresAt !== undefined ? { smsOtpExpiresAt: obj.smsOtpExpiresAt } : {}),
          ...(obj.smsOtpFailedAttempts !== undefined
            ? { smsOtpFailedAttempts: Number(obj.smsOtpFailedAttempts) }
            : {}),
          ...(Array.isArray(obj.trustedDevices) ? { trustedDevices: obj.trustedDevices } : {}),
        };
      }
      return { codes: [] };
    } catch {
      return { codes: [] };
    }
  }

  /** Tuần tự hóa lại JSON mở rộng (nếu không có metadata mở rộng thì xuất mảng thuần để giữ tương thích tối đa) */
  private serializeExtendedEnvelope(envelope: MfaExtendedEnvelope): string {
    const hasExtendedMetadata =
      Boolean(envelope.smsOtpEnabled) ||
      Boolean(envelope.smsOtpCodeHash) ||
      Boolean(envelope.trustedDevices && envelope.trustedDevices.length > 0);

    if (!hasExtendedMetadata) {
      return JSON.stringify(envelope.codes);
    }

    return JSON.stringify({
      codes: envelope.codes,
      ...(envelope.smsOtpEnabled ? { smsOtpEnabled: true } : {}),
      ...(envelope.smsOtpCodeHash
        ? {
            smsOtpCodeHash: envelope.smsOtpCodeHash,
            smsOtpExpiresAt: envelope.smsOtpExpiresAt ?? null,
            smsOtpFailedAttempts: envelope.smsOtpFailedAttempts ?? 0,
          }
        : {}),
      ...(envelope.trustedDevices && envelope.trustedDevices.length > 0
        ? { trustedDevices: envelope.trustedDevices }
        : {}),
    });
  }

  private filterActiveTrustedDevices(
    devices: StoredTrustedDeviceRecord[],
  ): StoredTrustedDeviceRecord[] {
    const nowMs = Date.now();
    return devices.filter((d) => {
      const untilMs = new Date(d.trustedUntil).getTime();
      return Number.isFinite(untilMs) && untilMs > nowMs;
    });
  }

  private toTrustedDeviceResponse(record: StoredTrustedDeviceRecord): TrustedDeviceItemResponse {
    return {
      deviceId: record.deviceId,
      deviceName: record.deviceName,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      trustedUntil: record.trustedUntil,
    };
  }

  private inferDeviceName(userAgent?: string | null): string | null {
    if (!userAgent) return 'Trusted Device';
    if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iOS Trusted Device';
    if (/Android/i.test(userAgent)) return 'Android Trusted Device';
    if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac Trusted Browser';
    if (/Windows/i.test(userAgent)) return 'Windows Trusted Browser';
    if (/Linux/i.test(userAgent)) return 'Linux Trusted Browser';
    return 'Trusted Browser';
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
    return code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  /** Che bớt địa chỉ email khi trả về thông báo gửi OTP (vd: ad***@gmail.com) */
  public maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return '***';
    const visible = localPart.slice(0, Math.min(2, localPart.length));
    return `${visible}***@${domain}`;
  }

  /** Che bớt số điện thoại khi trả về thông báo gửi SMS OTP (vd: 090****456) */
  public maskPhone(phone: string): string {
    const cleaned = phone.trim();
    if (cleaned.length <= 4) return '***';
    return `${cleaned.slice(0, 3)}****${cleaned.slice(-3)}`;
  }
}
