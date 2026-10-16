import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { BadRequestAppException, UnauthorizedAppException } from '@packages/kernel/index.js';
import {
  FieldEncryptionService,
  PasswordHasherService,
  TotpService,
} from '@packages/security/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import { MFA_METHOD, MFA_METHOD_NAME, type MfaMethodType } from '../contracts/index.js';
import type { AuthMfaConfigEntity } from '../entities/auth-mfa-config.entity.js';
import { AuthMfaConfigRepository } from '../repositories/auth-mfa-config.repository.js';
import type {
  DisableMfaRequest,
  EnableEmailOtpMfaRequest,
  EnableTotpMfaRequest,
} from '../requests/auth.requests.js';
import type {
  MfaEnableResultResponse,
  MfaStatusResponse,
  MfaTotpSetupResponse,
  SendEmailOtpResponse,
} from '../responses/auth.response.js';

const EMAIL_OTP_TTL_SECONDS = 300; // 5 phút

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly mfaRepository: AuthMfaConfigRepository,
    private readonly totpService: TotpService,
    private readonly passwordHasher: PasswordHasherService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly configService?: CoreConfigService,
    @Optional()
    private readonly fieldEncryption: FieldEncryptionService = new FieldEncryptionService(),
  ) {}

  /** Lấy trạng thái cấu hình MFA hiện tại của người dùng */
  public async getStatus(userId: number): Promise<MfaStatusResponse> {
    const config = await this.mfaRepository.findByUserId(userId);
    if (!config) {
      return {
        mfaEnabled: false,
        totpEnabled: false,
        emailOtpEnabled: false,
        preferredMethod: 'TOTP',
        remainingRecoveryCodesCount: 0,
        remainingRecoveryCodes: 0,
        verifiedAt: null,
      };
    }

    const recoveryHashes = this.parseRecoveryHashes(config.recoveryCodesHashJson);
    const mfaEnabled = Boolean(config.totpEnabled || config.emailOtpEnabled);
    const methodName = MFA_METHOD_NAME[config.preferredMethod] ?? 'TOTP';

    return {
      mfaEnabled,
      totpEnabled: Boolean(config.totpEnabled),
      emailOtpEnabled: Boolean(config.emailOtpEnabled),
      preferredMethod: methodName,
      remainingRecoveryCodesCount: recoveryHashes.length,
      remainingRecoveryCodes: recoveryHashes.length,
      verifiedAt: config.verifiedAt ? config.verifiedAt.toISOString() : null,
    };
  }

  /** Lấy danh sách các phương thức MFA đang khả dụng cho người dùng khi đăng nhập bước 2 */
  public async getAvailableMethodsForUser(userId: number): Promise<MfaMethodType[]> {
    const config = await this.mfaRepository.findByUserId(userId);
    if (!config) {
      return ['EMAIL_OTP'];
    }

    const methods: MfaMethodType[] = [];
    if (config.totpEnabled && config.totpSecret) {
      methods.push('TOTP');
    }
    if (config.emailOtpEnabled) {
      methods.push('EMAIL_OTP');
    }
    const recoveryHashes = this.parseRecoveryHashes(config.recoveryCodesHashJson);
    if (recoveryHashes.length > 0) {
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

    let config = await this.mfaRepository.findByUserId(userId);
    if (!config) {
      config = await this.mfaRepository.saveEntity({
        userId,
        totpSecret: encryptedSecret,
        totpEnabled: false,
        emailOtpEnabled: false,
        preferredMethod: MFA_METHOD.TOTP,
        recoveryCodesHashJson: '[]',
      });
    } else {
      config.totpSecret = encryptedSecret;
      await this.mfaRepository.saveEntity(config);
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
    const config = await this.mfaRepository.findByUserId(userId);
    if (!config || !config.totpSecret) {
      throw new BadRequestAppException('auth.mfaTotpNotSetup');
    }

    const plainSecret = this.fieldEncryption.decrypt(config.totpSecret);
    const isValid = this.totpService.verifyCode(plainSecret, dto.code);
    if (!isValid) {
      throw new BadRequestAppException('auth.invalidMfaCode');
    }

    const { plainCodes, hashesJson } = this.ensureRecoveryCodes(config);
    config.totpEnabled = true;
    config.preferredMethod = MFA_METHOD.TOTP;
    config.recoveryCodesHashJson = hashesJson;
    config.verifiedAt = new Date();

    await this.mfaRepository.saveEntity(config);
    await this.usersPublicService.setMfaEnabled(userId, true);

    return {
      mfaEnabled: true,
      totpEnabled: true,
      emailOtpEnabled: Boolean(config.emailOtpEnabled),
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
        recoveryCodes: [],
      };
    }

    let config = await this.mfaRepository.findByUserId(userId);
    if (!config) {
      config = await this.mfaRepository.saveEntity({
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

    const { plainCodes, hashesJson } = this.ensureRecoveryCodes(config);
    config.emailOtpEnabled = true;
    if (!config.totpEnabled) {
      config.preferredMethod = MFA_METHOD.EMAIL_OTP;
    }
    config.recoveryCodesHashJson = hashesJson;
    config.verifiedAt = new Date();

    await this.mfaRepository.saveEntity(config);
    await this.usersPublicService.setMfaEnabled(userId, true);

    return {
      mfaEnabled: true,
      totpEnabled: Boolean(config.totpEnabled),
      emailOtpEnabled: true,
      recoveryCodes: plainCodes,
    };
  }

  /** Phát sinh và gửi mã OTP 6 chữ số qua Email phục vụ xác thực bước 2 hoặc kích hoạt Email OTP */
  public async sendEmailOtp(userId: number): Promise<SendEmailOtpResponse> {
    const user = await this.usersPublicService.findAuthUserById(userId);
    if (!user) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const otpCode = this.passwordHasher.generateNumericOtp(6);
    const otpHash = this.passwordHasher.sha256(otpCode);
    const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_SECONDS * 1000);

    let config = await this.mfaRepository.findByUserId(userId);
    if (!config) {
      config = await this.mfaRepository.saveEntity({
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
      await this.mfaRepository.saveEntity(config);
    }

    const maskedEmail = this.maskEmail(user.email);
    this.logger.log(`Issued Email OTP for user ${user.id} (${maskedEmail})`);

    const isProd = this.configService?.app.env === 'production';
    return {
      sent: true,
      maskedEmail,
      expiresInSeconds: EMAIL_OTP_TTL_SECONDS,
      ...(!isProd ? { devOtpCode: otpCode } : {}),
    };
  }

  /** Xác minh mã MFA bước 2 (hỗ trợ cả TOTP, Email OTP và Recovery Code) */
  public async verifyMfaCode(
    userId: number,
    code: string,
    preferredMethod?: MfaMethodType,
  ): Promise<boolean> {
    const config = await this.mfaRepository.findByUserId(userId);
    if (!config) {
      return false;
    }

    const trimmedCode = code.trim();

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
        await this.mfaRepository.saveEntity(config);
        return true;
      }
    }

    // 4. Fallback kiểm tra Recovery Code không có dấu gạch ngang
    if (!preferredMethod && (await this.consumeRecoveryCode(config, trimmedCode))) {
      return true;
    }

    return false;
  }

  /** Tắt xác thực nhiều lớp (TOTP, Email OTP hoặc toàn bộ) */
  public async disableMfa(userId: number, dto: DisableMfaRequest): Promise<MfaStatusResponse> {
    const config = await this.mfaRepository.findByUserId(userId);
    if (!config) {
      await this.usersPublicService.setMfaEnabled(userId, false);
      return this.getStatus(userId);
    }

    if (dto.code) {
      const ok = await this.verifyMfaCode(userId, dto.code);
      if (!ok) {
        throw new BadRequestAppException('auth.invalidMfaCode');
      }
    }

    if (dto.method === 'TOTP') {
      config.totpEnabled = false;
      config.totpSecret = null;
    } else if (dto.method === 'EMAIL_OTP') {
      config.emailOtpEnabled = false;
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
      config.emailOtpFailedAttempts = 0;
    } else {
      config.totpEnabled = false;
      config.totpSecret = null;
      config.emailOtpEnabled = false;
      config.emailOtpCodeHash = null;
      config.emailOtpExpiresAt = null;
      config.emailOtpFailedAttempts = 0;
      config.recoveryCodesHashJson = '[]';
    }

    const stillEnabled = Boolean(config.totpEnabled || config.emailOtpEnabled);
    await this.mfaRepository.saveEntity(config);
    await this.usersPublicService.setMfaEnabled(userId, stillEnabled);

    return this.getStatus(userId);
  }

  /** Cấp lại bộ 8 mã khôi phục dự phòng (Recovery Codes) mới */
  public async regenerateRecoveryCodes(userId: number): Promise<{ recoveryCodes: string[] }> {
    const config = await this.mfaRepository.findByUserId(userId);
    if (!config || (!config.totpEnabled && !config.emailOtpEnabled)) {
      throw new BadRequestAppException('auth.mfaNotEnabled');
    }

    const plainCodes = this.totpService.generateRecoveryCodes(8);
    const hashes = plainCodes.map((c) => this.passwordHasher.sha256(this.normalizeRecoveryCode(c)));
    config.recoveryCodesHashJson = JSON.stringify(hashes);
    await this.mfaRepository.saveEntity(config);

    return { recoveryCodes: plainCodes };
  }

  /** Kiểm tra mã Email OTP đã lưu, thời hạn hiệu lực và giới hạn số lần nhập sai (tối đa 5 lần) */
  private async verifyAndTrackEmailOtp(config: AuthMfaConfigEntity, code: string): Promise<boolean> {
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
    await this.mfaRepository.saveEntity(config);
    return false;
  }

  /** Kiểm tra và gạch bỏ mã khôi phục dự phòng đã sử dụng */
  private async consumeRecoveryCode(
    config: AuthMfaConfigEntity,
    rawCode: string,
  ): Promise<boolean> {
    const hashes = this.parseRecoveryHashes(config.recoveryCodesHashJson);
    if (hashes.length === 0) return false;

    const candidateHash = this.passwordHasher.sha256(this.normalizeRecoveryCode(rawCode));
    const idx = hashes.indexOf(candidateHash);
    if (idx === -1) {
      return false;
    }

    hashes.splice(idx, 1);
    config.recoveryCodesHashJson = JSON.stringify(hashes);
    await this.mfaRepository.saveEntity(config);
    return true;
  }

  /** Sinh bộ mã khôi phục mới cho người dùng khi kích hoạt MFA lần đầu (giữ nguyên nếu đã có) */
  private ensureRecoveryCodes(config: AuthMfaConfigEntity): {
    plainCodes: string[];
    hashesJson: string;
  } {
    const existingHashes = this.parseRecoveryHashes(config.recoveryCodesHashJson);
    if (existingHashes.length > 0 && config.recoveryCodesHashJson) {
      return {
        plainCodes: [],
        hashesJson: config.recoveryCodesHashJson,
      };
    }
    const plainCodes = this.totpService.generateRecoveryCodes(8);
    const hashes = plainCodes.map((c) => this.passwordHasher.sha256(this.normalizeRecoveryCode(c)));
    return {
      plainCodes,
      hashesJson: JSON.stringify(hashes),
    };
  }

  /** Giải mã mảng JSON các mã băm Recovery Codes */
  private parseRecoveryHashes(jsonStr?: string | null): string[] {
    if (!jsonStr) return [];
    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
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
}
