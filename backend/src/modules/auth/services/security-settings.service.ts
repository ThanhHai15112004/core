import { Injectable, Optional } from '@nestjs/common';
import {
  DB_ENCRYPTION_ALGORITHMS,
  FieldEncryptionService,
  PASSWORD_HASH_ALGORITHMS,
  PasswordHasherService,
} from '@packages/security/index.js';
import {
  type MfaMethodType,
  getDbEncryptionAlgoName,
  getMfaPolicyName,
  getPasswordHashAlgoName,
  parseDbEncryptionAlgoCode,
  parseMfaPolicyCode,
  parsePasswordHashAlgoCode,
} from '../contracts/index.js';
import { AuthSecuritySettingRepository } from '../repositories/auth-security-setting.repository.js';
import type { UpdateSecuritySettingsRequest } from '../requests/auth.requests.js';
import type { SecuritySettingsResponse } from '../responses/auth.response.js';

@Injectable()
export class SecuritySettingsService {
  private cached: SecuritySettingsResponse = {
    passwordHashAlgorithm: 'SCRYPT',
    dbEncryptionAlgorithm: 'AES_256_GCM',
    encryptFieldsAtRest: true,
    mfaPolicy: 'OPTIONAL',
    allowedMfaMethods: ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'],
    maxFailedLoginAttempts: 5,
    lockoutDurationMinutes: 15,
    passwordMinLength: 8,
    requireUppercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    availablePasswordHashAlgorithms: [...PASSWORD_HASH_ALGORITHMS],
    availableDbEncryptionAlgorithms: [...DB_ENCRYPTION_ALGORITHMS],
    updatedAt: new Date().toISOString(),
  };

  constructor(
    @Optional() private readonly settingRepo?: AuthSecuritySettingRepository,
    @Optional() private readonly passwordHasher?: PasswordHasherService,
    @Optional() private readonly fieldEncryption?: FieldEncryptionService,
  ) {}

  /** Lấy cấu hình bảo mật & mã hóa hiện hành (ưu tiên đọc từ DB nếu sẵn sàng, fallback in-memory) */
  public async getSettings(): Promise<SecuritySettingsResponse> {
    if (this.settingRepo) {
      try {
        const persisted = await this.settingRepo.findByScopeKey('GLOBAL');
        if (persisted) {
          this.cached = {
            passwordHashAlgorithm: getPasswordHashAlgoName(
              parsePasswordHashAlgoCode(persisted.passwordHashAlgorithm),
            ),
            dbEncryptionAlgorithm: getDbEncryptionAlgoName(
              parseDbEncryptionAlgoCode(persisted.dbEncryptionAlgorithm),
            ),
            encryptFieldsAtRest: Boolean(persisted.encryptFieldsAtRest),
            mfaPolicy: getMfaPolicyName(parseMfaPolicyCode(persisted.mfaPolicy)),
            allowedMfaMethods: this.parseAllowedMethods(persisted.allowedMfaMethodsJson),
            maxFailedLoginAttempts: persisted.maxFailedLoginAttempts,
            lockoutDurationMinutes: persisted.lockoutDurationMinutes,
            passwordMinLength: persisted.passwordMinLength,
            requireUppercase: Boolean(persisted.requireUppercase),
            requireNumbers: Boolean(persisted.requireNumbers),
            requireSpecialChars: Boolean(persisted.requireSpecialChars),
            availablePasswordHashAlgorithms: [...PASSWORD_HASH_ALGORITHMS],
            availableDbEncryptionAlgorithms: [...DB_ENCRYPTION_ALGORITHMS],
            updatedAt: persisted.updatedAt
              ? persisted.updatedAt.toISOString()
              : this.cached.updatedAt,
          };
        }
      } catch {
        // Fallback an toàn về bộ nhớ đệm khi DB chưa khởi tạo bảng hoặc đang chạy chế độ không DB
      }
    }

    this.syncCryptoProviders(this.cached);
    return this.cached;
  }

  /** Cập nhật cấu hình bảo mật & mã hóa hệ thống và áp dụng tức thì cho các dịch vụ mật mã học */
  public async updateSettings(
    dto: UpdateSecuritySettingsRequest,
  ): Promise<SecuritySettingsResponse> {
    const current = await this.getSettings();
    const next: SecuritySettingsResponse = {
      ...current,
      ...(dto.passwordHashAlgorithm !== undefined
        ? { passwordHashAlgorithm: dto.passwordHashAlgorithm }
        : {}),
      ...(dto.dbEncryptionAlgorithm !== undefined
        ? { dbEncryptionAlgorithm: dto.dbEncryptionAlgorithm }
        : {}),
      ...(dto.encryptFieldsAtRest !== undefined
        ? { encryptFieldsAtRest: dto.encryptFieldsAtRest }
        : {}),
      ...(dto.mfaPolicy !== undefined ? { mfaPolicy: dto.mfaPolicy } : {}),
      ...(dto.allowedMfaMethods !== undefined ? { allowedMfaMethods: dto.allowedMfaMethods } : {}),
      ...(dto.maxFailedLoginAttempts !== undefined
        ? { maxFailedLoginAttempts: dto.maxFailedLoginAttempts }
        : {}),
      ...(dto.lockoutDurationMinutes !== undefined
        ? { lockoutDurationMinutes: dto.lockoutDurationMinutes }
        : {}),
      ...(dto.passwordMinLength !== undefined ? { passwordMinLength: dto.passwordMinLength } : {}),
      ...(dto.requireUppercase !== undefined ? { requireUppercase: dto.requireUppercase } : {}),
      ...(dto.requireNumbers !== undefined ? { requireNumbers: dto.requireNumbers } : {}),
      ...(dto.requireSpecialChars !== undefined
        ? { requireSpecialChars: dto.requireSpecialChars }
        : {}),
      updatedAt: new Date().toISOString(),
    };

    this.cached = next;
    this.syncCryptoProviders(next);

    if (this.settingRepo) {
      try {
        const existing = await this.settingRepo.findByScopeKey('GLOBAL');
        await this.settingRepo.saveEntity({
          ...(existing ? { id: existing.id } : {}),
          scopeKey: 'GLOBAL',
          passwordHashAlgorithm: parsePasswordHashAlgoCode(next.passwordHashAlgorithm),
          dbEncryptionAlgorithm: parseDbEncryptionAlgoCode(next.dbEncryptionAlgorithm),
          encryptFieldsAtRest: next.encryptFieldsAtRest,
          mfaPolicy: parseMfaPolicyCode(next.mfaPolicy),
          allowedMfaMethodsJson: JSON.stringify(next.allowedMfaMethods),
          maxFailedLoginAttempts: next.maxFailedLoginAttempts,
          lockoutDurationMinutes: next.lockoutDurationMinutes,
          passwordMinLength: next.passwordMinLength,
          requireUppercase: next.requireUppercase,
          requireNumbers: next.requireNumbers,
          requireSpecialChars: next.requireSpecialChars,
        });
      } catch {
        // Bỏ qua lỗi ghi DB nếu môi trường kiểm thử không chạy DB
      }
    }

    return this.cached;
  }

  private syncCryptoProviders(settings: SecuritySettingsResponse): void {
    this.passwordHasher?.setDefaultAlgorithm(settings.passwordHashAlgorithm);
    this.fieldEncryption?.setDefaultAlgorithm(settings.dbEncryptionAlgorithm);
  }

  private parseAllowedMethods(jsonStr?: string | null): MfaMethodType[] {
    if (!jsonStr) return ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'];
    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      if (!Array.isArray(parsed)) return ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'];
      const valid = parsed.filter(
        (m): m is MfaMethodType => m === 'TOTP' || m === 'EMAIL_OTP' || m === 'RECOVERY_CODE',
      );
      return valid.length > 0 ? valid : ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'];
    } catch {
      return ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'];
    }
  }
}
