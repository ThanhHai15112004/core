import { Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  SETTING_ITEM_STATUS,
  SETTING_VALUE_TYPE,
  SettingRegistryService,
  defaultSettingRegistry,
  safeJsonParse,
} from '@packages/kernel/index.js';
import {
  DB_ENCRYPTION_ALGORITHMS,
  type DbEncryptionAlgorithm,
  FieldEncryptionService,
  PASSWORD_HASH_ALGORITHMS,
  type PasswordHashAlgorithm,
  PasswordHasherService,
} from '@packages/security/index.js';
import {
  type MfaMethodType,
  type MfaPolicyType,
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

type SettingDescriptorKind =
  | 'number'
  | 'boolean'
  | 'passwordHashAlgo'
  | 'dbEncryptionAlgo'
  | 'mfaPolicy'
  | 'mfaMethods'
  | 'stringArray';

interface SecuritySettingDescriptor {
  readonly dtoField: keyof UpdateSecuritySettingsRequest;
  readonly key: string;
  readonly namespace: string;
  readonly kind: SettingDescriptorKind;
  readonly syncFromRegistryToDb?: boolean;
}

const VALID_MFA_POLICIES: ReadonlySet<string> = new Set([
  'OPTIONAL',
  'REQUIRED_FOR_ADMINS',
  'REQUIRED_FOR_ALL',
]);

const VALID_MFA_METHODS: ReadonlySet<string> = new Set([
  'TOTP',
  'EMAIL_OTP',
  'SMS_OTP',
  'RECOVERY_CODE',
]);

const SECURITY_SETTING_DESCRIPTORS: readonly SecuritySettingDescriptor[] = [
  // Password policy
  {
    dtoField: 'passwordMinLength',
    key: 'security.password.min_length',
    namespace: 'auth.password',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'requireUppercase',
    key: 'security.password.require_uppercase',
    namespace: 'auth.password',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'requireNumbers',
    key: 'security.password.require_numbers',
    namespace: 'auth.password',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'requireSpecialChars',
    key: 'security.password.require_special_chars',
    namespace: 'auth.password',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'requireCurrentPasswordOnChange',
    key: 'security.password.require_current_on_change',
    namespace: 'auth.password',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'disallowUserInfoInPassword',
    key: 'security.password.disallow_user_info',
    namespace: 'auth.password',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'disallowedPasswords',
    key: 'security.password.disallowed_list',
    namespace: 'auth.password',
    kind: 'stringArray',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'preventPasswordReuse',
    key: 'security.password.prevent_reuse',
    namespace: 'auth.password',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'passwordHistoryLimit',
    key: 'security.password.history_limit',
    namespace: 'auth.password',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'revokeSessionsOnPasswordChange',
    key: 'security.password.revoke_sessions_on_change',
    namespace: 'auth.password',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'passwordResetTtlSeconds',
    key: 'security.password.reset_ttl_seconds',
    namespace: 'auth.password',
    kind: 'number',
  },
  // Crypto
  {
    dtoField: 'passwordHashAlgorithm',
    key: 'security.crypto.password_hash_algorithm',
    namespace: 'auth.crypto',
    kind: 'passwordHashAlgo',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'dbEncryptionAlgorithm',
    key: 'security.crypto.db_encryption_algorithm',
    namespace: 'auth.crypto',
    kind: 'dbEncryptionAlgo',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'encryptFieldsAtRest',
    key: 'security.crypto.encrypt_fields_at_rest',
    namespace: 'auth.crypto',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  // MFA & Step-Up
  {
    dtoField: 'mfaPolicy',
    key: 'security.mfa.policy',
    namespace: 'auth.mfa',
    kind: 'mfaPolicy',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'allowedMfaMethods',
    key: 'security.mfa.allowed_methods',
    namespace: 'auth.mfa',
    kind: 'mfaMethods',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'mfaEmailOtpTtlSeconds',
    key: 'security.mfa.email_otp_ttl_seconds',
    namespace: 'auth.mfa',
    kind: 'number',
  },
  {
    dtoField: 'mfaSmsOtpTtlSeconds',
    key: 'security.mfa.sms_otp_ttl_seconds',
    namespace: 'auth.mfa',
    kind: 'number',
  },
  {
    dtoField: 'mfaTrustedDeviceDays',
    key: 'security.mfa.trusted_device_days',
    namespace: 'auth.mfa',
    kind: 'number',
  },
  {
    dtoField: 'mfaMaxTrustedDevices',
    key: 'security.mfa.max_trusted_devices',
    namespace: 'auth.mfa',
    kind: 'number',
  },
  {
    dtoField: 'mfaRecoveryCodeCount',
    key: 'security.mfa.recovery_code_count',
    namespace: 'auth.mfa',
    kind: 'number',
  },
  {
    dtoField: 'mfaChallengeTtlSeconds',
    key: 'security.mfa.challenge_ttl_seconds',
    namespace: 'auth.mfa',
    kind: 'number',
  },
  {
    dtoField: 'mfaAdminRoleCodes',
    key: 'security.mfa.admin_role_codes',
    namespace: 'auth.mfa',
    kind: 'stringArray',
  },
  {
    dtoField: 'stepUpTokenTtlSeconds',
    key: 'security.step_up.ttl_seconds',
    namespace: 'auth.step_up',
    kind: 'number',
  },
  // Login & Registration & Verification & OTP
  {
    dtoField: 'maxFailedLoginAttempts',
    key: 'security.login.max_failed_attempts',
    namespace: 'auth.login',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'lockoutDurationMinutes',
    key: 'security.login.lockout_duration_minutes',
    namespace: 'auth.login',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'allowEmailRegistration',
    key: 'security.registration.allow_email',
    namespace: 'auth.registration',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'allowPhoneRegistration',
    key: 'security.registration.allow_phone',
    namespace: 'auth.registration',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'requireEmailVerification',
    key: 'security.registration.require_email_verification',
    namespace: 'auth.registration',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'requirePhoneVerification',
    key: 'security.registration.require_phone_verification',
    namespace: 'auth.registration',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'emailVerificationTtlSeconds',
    key: 'security.verification.email_ttl_seconds',
    namespace: 'auth.verification',
    kind: 'number',
  },
  {
    dtoField: 'phoneOtpTtlSeconds',
    key: 'security.verification.phone_otp_ttl_seconds',
    namespace: 'auth.verification',
    kind: 'number',
  },
  {
    dtoField: 'otpMaxSendCount',
    key: 'security.otp.max_send_count',
    namespace: 'auth.otp',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'otpMaxAttempts',
    key: 'security.otp.max_attempts',
    namespace: 'auth.otp',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'otpCooldownSeconds',
    key: 'security.otp.cooldown_seconds',
    namespace: 'auth.otp',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  // Session & Audit & API Client
  {
    dtoField: 'sessionIdleTimeoutMinutes',
    key: 'security.session.idle_timeout_minutes',
    namespace: 'auth.session',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'sessionMaxLifetimeMinutes',
    key: 'security.session.max_lifetime_minutes',
    namespace: 'auth.session',
    kind: 'number',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'sessionAccessTokenTtlSeconds',
    key: 'security.session.access_token_ttl_seconds',
    namespace: 'auth.session',
    kind: 'number',
  },
  {
    dtoField: 'sessionRefreshTokenTtlSeconds',
    key: 'security.session.refresh_token_ttl_seconds',
    namespace: 'auth.session',
    kind: 'number',
  },
  {
    dtoField: 'enableLoginAuditLog',
    key: 'security.audit.enable_login_log',
    namespace: 'auth.audit',
    kind: 'boolean',
    syncFromRegistryToDb: true,
  },
  {
    dtoField: 'apiClientDefaultTokenTtlSeconds',
    key: 'security.api_client.default_token_ttl_seconds',
    namespace: 'auth.api_client',
    kind: 'number',
  },
  {
    dtoField: 'apiClientMaxUsageLogs',
    key: 'security.api_client.max_usage_logs',
    namespace: 'auth.api_client',
    kind: 'number',
  },
];

const DESCRIPTOR_BY_KEY = new Map<string, SecuritySettingDescriptor>(
  SECURITY_SETTING_DESCRIPTORS.map((d) => [d.key, d]),
);

function coerceRegistryEventValue(kind: SettingDescriptorKind, raw: unknown): unknown {
  switch (kind) {
    case 'number':
      return typeof raw === 'number' ? raw : undefined;
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'passwordHashAlgo':
      return typeof raw === 'string' &&
        (PASSWORD_HASH_ALGORITHMS as readonly string[]).includes(raw)
        ? (raw as PasswordHashAlgorithm)
        : undefined;
    case 'dbEncryptionAlgo':
      return typeof raw === 'string' &&
        (DB_ENCRYPTION_ALGORITHMS as readonly string[]).includes(raw)
        ? (raw as DbEncryptionAlgorithm)
        : undefined;
    case 'mfaPolicy':
      return typeof raw === 'string' && VALID_MFA_POLICIES.has(raw)
        ? (raw as MfaPolicyType)
        : undefined;
    case 'mfaMethods': {
      if (!Array.isArray(raw)) return undefined;
      const valid = raw.filter(
        (m): m is MfaMethodType => typeof m === 'string' && VALID_MFA_METHODS.has(m),
      );
      return valid.length > 0 ? valid : undefined;
    }
    case 'stringArray':
      return Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === 'string')
        : undefined;
  }
}

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
      if (this.isSyncingFromRegistry || evt.organizationUnitId !== null || !this.settingRepo) {
        return;
      }
      if (evt.environment !== 'ALL' && evt.environment !== this.registry.getActiveEnvironment()) {
        return;
      }
      const descriptor = DESCRIPTOR_BY_KEY.get(evt.key);
      if (!descriptor?.syncFromRegistryToDb) {
        return;
      }
      const parsedValue = coerceRegistryEventValue(descriptor.kind, evt.value);
      if (parsedValue === undefined) {
        return;
      }
      try {
        this.isSyncingFromRegistry = true;
        await this.updateSettings({
          [descriptor.dtoField]: parsedValue,
        } as UpdateSecuritySettingsRequest);
      } finally {
        this.isSyncingFromRegistry = false;
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
    const definedUpdates: Record<string, unknown> = {};
    for (const { dtoField } of SECURITY_SETTING_DESCRIPTORS) {
      const val = dto[dtoField];
      if (val !== undefined) {
        definedUpdates[dtoField] = val;
      }
    }
    if (dto.disallowedPasswords !== undefined) {
      definedUpdates.disallowedPasswords = [
        ...new Set(dto.disallowedPasswords.map((p) => p.trim().toLowerCase()).filter(Boolean)),
      ];
    }
    if (dto.mfaAdminRoleCodes !== undefined) {
      definedUpdates.mfaAdminRoleCodes = [
        ...new Set(dto.mfaAdminRoleCodes.map((r) => r.trim().toUpperCase()).filter(Boolean)),
      ];
    }

    const next: SecuritySettingsResponse = {
      ...current,
      ...(definedUpdates as Partial<SecuritySettingsResponse>),
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
    if (!this.isSyncingFromRegistry) {
      await this.syncToSettingRegistry(dto, next);
    }
    const settings = this.toResponse(saved);
    this.syncCryptoProviders(settings);
    return settings;
  }

  private async syncToSettingRegistry(
    dto: UpdateSecuritySettingsRequest,
    settings: SecuritySettingsResponse,
  ): Promise<void> {
    for (const item of SECURITY_SETTING_DESCRIPTORS) {
      if (dto[item.dtoField] === undefined) {
        continue;
      }
      const value = settings[item.dtoField as keyof SecuritySettingsResponse];
      const isJson = item.kind === 'mfaMethods' || item.kind === 'stringArray';
      const serialized = isJson ? JSON.stringify(value) : String(value);
      const existing = this.registry.getDefinition(item.key);
      const isBoolean = item.kind === 'boolean';
      const isNumber = item.kind === 'number';
      if (existing) {
        this.registry.upsertDefinition({
          ...existing,
          globalSerializedValue: serialized,
        });
      } else {
        this.registry.upsertDefinition({
          id: 0,
          key: item.key,
          groupId: 0,
          groupCode: 'security',
          module: 'auth',
          namespace: item.namespace,
          name: item.key,
          description: null,
          valueType: isJson
            ? SETTING_VALUE_TYPE.JSON
            : isBoolean
              ? SETTING_VALUE_TYPE.BOOLEAN
              : isNumber
                ? SETTING_VALUE_TYPE.NUMBER
                : SETTING_VALUE_TYPE.TEXT,
          valueTypeName: isJson ? 'JSON' : isBoolean ? 'BOOLEAN' : isNumber ? 'NUMBER' : 'TEXT',
          defaultSerializedValue: serialized,
          globalSerializedValue: serialized,
          isSensitive: false,
          isEncrypted: false,
          allowUnitOverride: true,
          validationRules: {},
          isSystem: true,
          sortOrder: 0,
          status: SETTING_ITEM_STATUS.ACTIVE,
          updatedBy: null,
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
          value,
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
      passwordResetTtlSeconds: this.registry.getNumber(
        'security.password.reset_ttl_seconds',
        undefined,
        900,
      ),
      mfaEmailOtpTtlSeconds: this.registry.getNumber(
        'security.mfa.email_otp_ttl_seconds',
        undefined,
        300,
      ),
      mfaSmsOtpTtlSeconds: this.registry.getNumber(
        'security.mfa.sms_otp_ttl_seconds',
        undefined,
        300,
      ),
      mfaTrustedDeviceDays: this.registry.getNumber(
        'security.mfa.trusted_device_days',
        undefined,
        30,
      ),
      mfaMaxTrustedDevices: this.registry.getNumber(
        'security.mfa.max_trusted_devices',
        undefined,
        20,
      ),
      mfaRecoveryCodeCount: this.registry.getNumber(
        'security.mfa.recovery_code_count',
        undefined,
        8,
      ),
      mfaChallengeTtlSeconds: this.registry.getNumber(
        'security.mfa.challenge_ttl_seconds',
        undefined,
        300,
      ),
      mfaAdminRoleCodes: this.registry.getJson<string[]>(
        'security.mfa.admin_role_codes',
        undefined,
        ['SUPER_ADMIN', 'ADMIN', 'SYSTEM_ADMIN', 'IAM_ADMIN', 'SECURITY_ADMIN'],
      ),
      stepUpTokenTtlSeconds: this.registry.getNumber(
        'security.step_up.ttl_seconds',
        undefined,
        300,
      ),
      emailVerificationTtlSeconds: this.registry.getNumber(
        'security.verification.email_ttl_seconds',
        undefined,
        900,
      ),
      phoneOtpTtlSeconds: this.registry.getNumber(
        'security.verification.phone_otp_ttl_seconds',
        undefined,
        300,
      ),
      sessionAccessTokenTtlSeconds: this.registry.getNumber(
        'security.session.access_token_ttl_seconds',
        undefined,
        900,
      ),
      sessionRefreshTokenTtlSeconds: this.registry.getNumber(
        'security.session.refresh_token_ttl_seconds',
        undefined,
        604800,
      ),
      apiClientDefaultTokenTtlSeconds: this.registry.getNumber(
        'security.api_client.default_token_ttl_seconds',
        undefined,
        3600,
      ),
      apiClientMaxUsageLogs: this.registry.getNumber(
        'security.api_client.max_usage_logs',
        undefined,
        50,
      ),
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
    const parsed = safeJsonParse<unknown>(jsonStr, null);
    if (!Array.isArray(parsed)) return ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'];
    const valid = parsed.filter(
      (m): m is MfaMethodType =>
        m === 'TOTP' || m === 'EMAIL_OTP' || m === 'SMS_OTP' || m === 'RECOVERY_CODE',
    );
    return valid.length > 0 ? valid : ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'];
  }

  private parseDisallowedPasswords(
    jsonStr?: string | null,
    fallback: readonly string[] = DEFAULT_DISALLOWED_PASSWORDS,
  ): string[] {
    const parsed = safeJsonParse<unknown>(jsonStr, null);
    if (!Array.isArray(parsed)) return [...fallback];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
}
