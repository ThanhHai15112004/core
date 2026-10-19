import { Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  SettingRegistryService,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
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
  private readonly registry: SettingRegistryService;
  private isSyncingFromRegistry = false;

  constructor(
    private readonly settingRepo: AuthSecuritySettingRepository,
    @Optional() private readonly passwordHasher?: PasswordHasherService,
    @Optional() private readonly fieldEncryption?: FieldEncryptionService,
    @Optional() settingRegistry?: SettingRegistryService,
  ) {
    this.registry = settingRegistry ?? defaultSettingRegistry;
    this.registry.onSettingChanged(async (evt) => {
      if (this.isSyncingFromRegistry || evt.organizationUnitId !== null) {
        return;
      }
      if (evt.environment !== 'ALL' && evt.environment !== this.registry.getActiveEnvironment()) {
        return;
      }
      const patch: Partial<UpdateSecuritySettingsRequest> = {};
      if (evt.key === 'security.password.min_length' && typeof evt.value === 'number') {
        patch.passwordMinLength = evt.value;
      } else if (
        evt.key === 'security.password.require_uppercase' &&
        typeof evt.value === 'boolean'
      ) {
        patch.requireUppercase = evt.value;
      } else if (
        evt.key === 'security.password.require_numbers' &&
        typeof evt.value === 'boolean'
      ) {
        patch.requireNumbers = evt.value;
      } else if (
        evt.key === 'security.password.require_special_chars' &&
        typeof evt.value === 'boolean'
      ) {
        patch.requireSpecialChars = evt.value;
      } else if (
        evt.key === 'security.login.max_failed_attempts' &&
        typeof evt.value === 'number'
      ) {
        patch.maxFailedLoginAttempts = evt.value;
      } else if (
        evt.key === 'security.login.lockout_duration_minutes' &&
        typeof evt.value === 'number'
      ) {
        patch.lockoutDurationMinutes = evt.value;
      } else if (
        evt.key === 'security.session.idle_timeout_minutes' &&
        typeof evt.value === 'number'
      ) {
        patch.sessionIdleTimeoutMinutes = evt.value;
      }

      if (Object.keys(patch).length > 0 && this.settingRepo) {
        try {
          this.isSyncingFromRegistry = true;
          await this.updateSettings(patch as UpdateSecuritySettingsRequest);
        } finally {
          this.isSyncingFromRegistry = false;
        }
      }
    });
  }

  /** Lấy cấu hình bảo mật & mã hóa hiện hành trực tiếp từ DB */
  public async getSettings(): Promise<SecuritySettingsResponse> {
    if (!this.settingRepo) {
      throw new Error('AuthSecuritySettingRepository is not initialized');
    }
    let persisted = await this.settingRepo.findGlobal();
    if (!persisted) {
      persisted = await this.settingRepo.saveGlobal({ scopeKey: 'GLOBAL' });
    }
    const settings = this.toResponse(persisted);
    this.syncCryptoProviders(settings);
    return settings;
  }

  /** Cập nhật cấu hình bảo mật & mã hóa hệ thống vào DB và áp dụng tức thì cho các dịch vụ mật mã học */
  public async updateSettings(
    dto: UpdateSecuritySettingsRequest,
  ): Promise<SecuritySettingsResponse> {
    if (!this.settingRepo) {
      throw new Error('AuthSecuritySettingRepository is not initialized');
    }
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
      ...(dto.sessionIdleTimeoutMinutes !== undefined
        ? { sessionIdleTimeoutMinutes: dto.sessionIdleTimeoutMinutes }
        : {}),
      ...(dto.sessionMaxLifetimeMinutes !== undefined
        ? { sessionMaxLifetimeMinutes: dto.sessionMaxLifetimeMinutes }
        : {}),
      ...(dto.enableLoginAuditLog !== undefined
        ? { enableLoginAuditLog: dto.enableLoginAuditLog }
        : {}),
      updatedAt: new Date().toISOString(),
    };

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
      sessionIdleTimeoutMinutes: next.sessionIdleTimeoutMinutes ?? 30,
      sessionMaxLifetimeMinutes: next.sessionMaxLifetimeMinutes ?? 10080,
      enableLoginAuditLog: next.enableLoginAuditLog ?? true,
    };

    const saved = await this.settingRepo.saveGlobal(entityPayload);
    const settings = this.toResponse(saved);
    this.syncCryptoProviders(settings);
    if (!this.isSyncingFromRegistry) {
      await this.syncToSettingRegistry(dto, settings);
    }
    return settings;
  }

  private async syncToSettingRegistry(
    dto: UpdateSecuritySettingsRequest,
    settings: SecuritySettingsResponse,
  ): Promise<void> {
    const mappings: Array<{
      dtoField: keyof UpdateSecuritySettingsRequest;
      key: string;
      namespace: string;
      value: unknown;
    }> = [
      {
        dtoField: 'passwordMinLength',
        key: 'security.password.min_length',
        namespace: 'auth.password',
        value: settings.passwordMinLength,
      },
      {
        dtoField: 'requireUppercase',
        key: 'security.password.require_uppercase',
        namespace: 'auth.password',
        value: settings.requireUppercase,
      },
      {
        dtoField: 'requireNumbers',
        key: 'security.password.require_numbers',
        namespace: 'auth.password',
        value: settings.requireNumbers,
      },
      {
        dtoField: 'requireSpecialChars',
        key: 'security.password.require_special_chars',
        namespace: 'auth.password',
        value: settings.requireSpecialChars,
      },
      {
        dtoField: 'maxFailedLoginAttempts',
        key: 'security.login.max_failed_attempts',
        namespace: 'auth.login',
        value: settings.maxFailedLoginAttempts,
      },
      {
        dtoField: 'lockoutDurationMinutes',
        key: 'security.login.lockout_duration_minutes',
        namespace: 'auth.login',
        value: settings.lockoutDurationMinutes,
      },
      {
        dtoField: 'sessionIdleTimeoutMinutes',
        key: 'security.session.idle_timeout_minutes',
        namespace: 'auth.session',
        value: settings.sessionIdleTimeoutMinutes,
      },
    ];

    for (const item of mappings) {
      if (dto[item.dtoField] === undefined) {
        continue;
      }
      const existing = this.registry.getDefinition(item.key);
      if (existing) {
        this.registry.upsertDefinition({
          ...existing,
          globalSerializedValue: String(item.value),
        });
      }
      try {
        this.isSyncingFromRegistry = true;
        await this.registry.notifySettingChanged({
          key: item.key,
          module: 'auth',
          namespace: item.namespace,
          environment: 'ALL',
          organizationUnitId: null,
          value: item.value,
        });
      } finally {
        this.isSyncingFromRegistry = false;
      }
    }
  }

  private toResponse(persisted: AuthSecuritySettingEntity): SecuritySettingsResponse {
    return {
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
          : true,
      disallowedPasswords: this.parseDisallowedPasswords(
        persisted.disallowedPasswordsJson,
        DEFAULT_DISALLOWED_PASSWORDS,
      ),
      disallowUserInfoInPassword:
        persisted.disallowUserInfoInPassword !== undefined
          ? Boolean(persisted.disallowUserInfoInPassword)
          : true,
      preventPasswordReuse:
        persisted.preventPasswordReuse !== undefined
          ? Boolean(persisted.preventPasswordReuse)
          : true,
      passwordHistoryLimit: persisted.passwordHistoryLimit ?? 5,
      revokeSessionsOnPasswordChange:
        persisted.revokeSessionsOnPasswordChange !== undefined
          ? Boolean(persisted.revokeSessionsOnPasswordChange)
          : true,
      allowEmailRegistration:
        persisted.allowEmailRegistration !== undefined
          ? Boolean(persisted.allowEmailRegistration)
          : true,
      allowPhoneRegistration:
        persisted.allowPhoneRegistration !== undefined
          ? Boolean(persisted.allowPhoneRegistration)
          : true,
      requireEmailVerification:
        persisted.requireEmailVerification !== undefined
          ? Boolean(persisted.requireEmailVerification)
          : false,
      requirePhoneVerification:
        persisted.requirePhoneVerification !== undefined
          ? Boolean(persisted.requirePhoneVerification)
          : false,
      otpMaxSendCount: persisted.otpMaxSendCount ?? 5,
      otpMaxAttempts: persisted.otpMaxAttempts ?? 5,
      otpCooldownSeconds: persisted.otpCooldownSeconds ?? 60,
      sessionIdleTimeoutMinutes:
        persisted.sessionIdleTimeoutMinutes !== undefined
          ? Number(persisted.sessionIdleTimeoutMinutes)
          : 30,
      sessionMaxLifetimeMinutes:
        persisted.sessionMaxLifetimeMinutes !== undefined
          ? Number(persisted.sessionMaxLifetimeMinutes)
          : 10080,
      enableLoginAuditLog:
        persisted.enableLoginAuditLog !== undefined ? Boolean(persisted.enableLoginAuditLog) : true,
      availablePasswordHashAlgorithms: [...PASSWORD_HASH_ALGORITHMS],
      availableDbEncryptionAlgorithms: [...DB_ENCRYPTION_ALGORITHMS],
      updatedAt: (persisted.updatedAt ?? new Date()).toISOString(),
    };
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
        (m): m is MfaMethodType =>
          m === 'TOTP' || m === 'EMAIL_OTP' || m === 'SMS_OTP' || m === 'RECOVERY_CODE',
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
