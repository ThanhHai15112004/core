import { Injectable, Optional } from '@nestjs/common';
import { BadRequestAppException } from '@packages/kernel/index.js';
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
import type { AuthSecuritySettingEntity } from '../entities/auth-security-setting.entity.js';
import { AuthSecuritySettingRepository } from '../repositories/auth-security-setting.repository.js';
import type { UpdateSecuritySettingsRequest } from '../requests/auth.requests.js';
import type { SecuritySettingsResponse } from '../responses/auth.response.js';

export const DEFAULT_DISALLOWED_PASSWORDS: readonly string[] = [
  'password',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'admin123',
  'welcome123',
  'letmein123',
  'iloveyou',
  'abcd1234',
];

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
    requireSpecialChars: false,
    requireCurrentPasswordOnChange: true,
    disallowedPasswords: [...DEFAULT_DISALLOWED_PASSWORDS],
    disallowUserInfoInPassword: true,
    preventPasswordReuse: true,
    passwordHistoryLimit: 5,
    revokeSessionsOnPasswordChange: true,
    allowEmailRegistration: true,
    allowPhoneRegistration: true,
    requireEmailVerification: false,
    requirePhoneVerification: false,
    otpMaxSendCount: 5,
    otpMaxAttempts: 5,
    otpCooldownSeconds: 60,
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
        const repoAny = this.settingRepo as unknown as {
          findByScopeKey?: (scope: string) => Promise<AuthSecuritySettingEntity | null>;
          findGlobal?: () => Promise<AuthSecuritySettingEntity | null>;
        };
        const persisted =
          typeof repoAny.findByScopeKey === 'function'
            ? await repoAny.findByScopeKey('GLOBAL')
            : typeof repoAny.findGlobal === 'function'
              ? await repoAny.findGlobal()
              : null;

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
            requireCurrentPasswordOnChange:
              persisted.requireCurrentPasswordOnChange !== undefined
                ? Boolean(persisted.requireCurrentPasswordOnChange)
                : this.cached.requireCurrentPasswordOnChange,
            disallowedPasswords: this.parseDisallowedPasswords(
              persisted.disallowedPasswordsJson,
              this.cached.disallowedPasswords,
            ),
            disallowUserInfoInPassword:
              persisted.disallowUserInfoInPassword !== undefined
                ? Boolean(persisted.disallowUserInfoInPassword)
                : this.cached.disallowUserInfoInPassword,
            preventPasswordReuse:
              persisted.preventPasswordReuse !== undefined
                ? Boolean(persisted.preventPasswordReuse)
                : this.cached.preventPasswordReuse,
            passwordHistoryLimit:
              persisted.passwordHistoryLimit ?? this.cached.passwordHistoryLimit,
            revokeSessionsOnPasswordChange:
              persisted.revokeSessionsOnPasswordChange !== undefined
                ? Boolean(persisted.revokeSessionsOnPasswordChange)
                : this.cached.revokeSessionsOnPasswordChange,
            allowEmailRegistration:
              persisted.allowEmailRegistration !== undefined
                ? Boolean(persisted.allowEmailRegistration)
                : this.cached.allowEmailRegistration,
            allowPhoneRegistration:
              persisted.allowPhoneRegistration !== undefined
                ? Boolean(persisted.allowPhoneRegistration)
                : this.cached.allowPhoneRegistration,
            requireEmailVerification:
              persisted.requireEmailVerification !== undefined
                ? Boolean(persisted.requireEmailVerification)
                : this.cached.requireEmailVerification,
            requirePhoneVerification:
              persisted.requirePhoneVerification !== undefined
                ? Boolean(persisted.requirePhoneVerification)
                : this.cached.requirePhoneVerification,
            otpMaxSendCount: persisted.otpMaxSendCount ?? this.cached.otpMaxSendCount,
            otpMaxAttempts: persisted.otpMaxAttempts ?? this.cached.otpMaxAttempts,
            otpCooldownSeconds: persisted.otpCooldownSeconds ?? this.cached.otpCooldownSeconds,
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
      ...(dto.requireCurrentPasswordOnChange !== undefined
        ? { requireCurrentPasswordOnChange: dto.requireCurrentPasswordOnChange }
        : {}),
      ...(dto.disallowedPasswords !== undefined
        ? {
            disallowedPasswords: [
              ...new Set(
                dto.disallowedPasswords.map((p) => p.trim().toLowerCase()).filter(Boolean),
              ),
            ],
          }
        : {}),
      ...(dto.disallowUserInfoInPassword !== undefined
        ? { disallowUserInfoInPassword: dto.disallowUserInfoInPassword }
        : {}),
      ...(dto.preventPasswordReuse !== undefined
        ? { preventPasswordReuse: dto.preventPasswordReuse }
        : {}),
      ...(dto.passwordHistoryLimit !== undefined
        ? { passwordHistoryLimit: dto.passwordHistoryLimit }
        : {}),
      ...(dto.revokeSessionsOnPasswordChange !== undefined
        ? { revokeSessionsOnPasswordChange: dto.revokeSessionsOnPasswordChange }
        : {}),
      ...(dto.allowEmailRegistration !== undefined
        ? { allowEmailRegistration: dto.allowEmailRegistration }
        : {}),
      ...(dto.allowPhoneRegistration !== undefined
        ? { allowPhoneRegistration: dto.allowPhoneRegistration }
        : {}),
      ...(dto.requireEmailVerification !== undefined
        ? { requireEmailVerification: dto.requireEmailVerification }
        : {}),
      ...(dto.requirePhoneVerification !== undefined
        ? { requirePhoneVerification: dto.requirePhoneVerification }
        : {}),
      ...(dto.otpMaxSendCount !== undefined ? { otpMaxSendCount: dto.otpMaxSendCount } : {}),
      ...(dto.otpMaxAttempts !== undefined ? { otpMaxAttempts: dto.otpMaxAttempts } : {}),
      ...(dto.otpCooldownSeconds !== undefined
        ? { otpCooldownSeconds: dto.otpCooldownSeconds }
        : {}),
      updatedAt: new Date().toISOString(),
    };

    this.cached = next;
    this.syncCryptoProviders(next);

    if (this.settingRepo) {
      const entityPayload: Partial<AuthSecuritySettingEntity> = {
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
        requireCurrentPasswordOnChange: next.requireCurrentPasswordOnChange,
        disallowedPasswordsJson: JSON.stringify(next.disallowedPasswords),
        disallowUserInfoInPassword: next.disallowUserInfoInPassword,
        preventPasswordReuse: next.preventPasswordReuse,
        passwordHistoryLimit: next.passwordHistoryLimit,
        revokeSessionsOnPasswordChange: next.revokeSessionsOnPasswordChange,
        allowEmailRegistration: next.allowEmailRegistration,
        allowPhoneRegistration: next.allowPhoneRegistration,
        requireEmailVerification: next.requireEmailVerification,
        requirePhoneVerification: next.requirePhoneVerification,
        otpMaxSendCount: next.otpMaxSendCount,
        otpMaxAttempts: next.otpMaxAttempts,
        otpCooldownSeconds: next.otpCooldownSeconds,
      };

      const repoAny = this.settingRepo as unknown as {
        findByScopeKey?: (scope: string) => Promise<AuthSecuritySettingEntity | null>;
        saveEntity?: (data: Partial<AuthSecuritySettingEntity>) => Promise<unknown>;
        saveGlobal?: (data: Partial<AuthSecuritySettingEntity>) => Promise<unknown>;
      };

      try {
        if (typeof repoAny.saveGlobal === 'function') {
          await repoAny.saveGlobal(entityPayload);
        }
      } catch {
        // Bỏ qua lỗi ghi mock
      }

      try {
        if (
          typeof repoAny.findByScopeKey === 'function' &&
          typeof repoAny.saveEntity === 'function'
        ) {
          const existing = await repoAny.findByScopeKey('GLOBAL');
          await repoAny.saveEntity({
            ...(existing ? { id: existing.id } : {}),
            ...entityPayload,
          });
        }
      } catch {
        // Bỏ qua lỗi ghi DB nếu môi trường kiểm thử không chạy DB
      }
    }

    return this.cached;
  }

  /**
   * Kiểm tra mật khẩu theo các biến setting chính sách mật khẩu hiện hành (Mục 3.3.4):
   * - Độ dài tối thiểu (`passwordMinLength`)
   * - Độ mạnh (`requireUppercase`, `requireNumbers`, `requireSpecialChars`)
   * - Mật khẩu không được dùng (`disallowedPasswords`)
   * - Không chứa thông tin định danh tài khoản (`disallowUserInfoInPassword`)
   */
  public async validatePasswordPolicy(
    password: string,
    context?: {
      username?: string | null | undefined;
      email?: string | null | undefined;
      phone?: string | null | undefined;
    },
  ): Promise<SecuritySettingsResponse> {
    const settings = await this.getSettings();
    const minLength = settings.passwordMinLength ?? 8;

    if (password.length < minLength) {
      throw new BadRequestAppException('auth.passwordPolicyViolation', [{ minLength }]);
    }
    if (settings.requireUppercase && !/[A-Z]/.test(password)) {
      throw new BadRequestAppException('auth.passwordPolicyViolation', [
        { requireUppercase: true },
      ]);
    }
    if (settings.requireNumbers && !/\d/.test(password)) {
      throw new BadRequestAppException('auth.passwordPolicyViolation', [{ requireNumbers: true }]);
    }
    if (settings.requireSpecialChars && !/[^A-Za-z0-9]/.test(password)) {
      throw new BadRequestAppException('auth.passwordPolicyViolation', [
        { requireSpecialChars: true },
      ]);
    }

    const lowerPwd = password.trim().toLowerCase();
    const bannedList = settings.disallowedPasswords ?? DEFAULT_DISALLOWED_PASSWORDS;
    if (bannedList.some((b) => b.trim().toLowerCase() === lowerPwd)) {
      throw new BadRequestAppException('auth.passwordDisallowed', [{ reason: 'disallowed_list' }]);
    }

    if (settings.disallowUserInfoInPassword && context) {
      const tokens: string[] = [];
      if (context.username && context.username.trim().length >= 3) {
        tokens.push(context.username.trim().toLowerCase());
      }
      if (context.email && context.email.includes('@')) {
        const emailLocal = context.email.split('@')[0]?.trim().toLowerCase();
        if (emailLocal && emailLocal.length >= 3) {
          tokens.push(emailLocal);
        }
      }
      if (context.phone && context.phone.trim().length >= 6) {
        tokens.push(context.phone.trim().replace(/\D/g, ''));
      }
      if (tokens.some((tok) => tok.length >= 3 && lowerPwd.includes(tok))) {
        throw new BadRequestAppException('auth.passwordDisallowed', [
          { reason: 'matches_user_identity' },
        ]);
      }
    }

    return settings;
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

  private parseDisallowedPasswords(
    jsonStr?: string | null,
    fallback: readonly string[] = DEFAULT_DISALLOWED_PASSWORDS,
  ): string[] {
    if (!jsonStr) return [...fallback];
    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      if (!Array.isArray(parsed)) return [...fallback];
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } catch {
      return [...fallback];
    }
  }
}

