import type { DbEncryptionAlgorithm, PasswordHashAlgorithm } from '@packages/security/index.js';
import type { SecuritySettingDescriptor } from '../types/credentials.types.js';

export type MfaMethodType = 'TOTP' | 'EMAIL_OTP' | 'SMS_OTP' | 'RECOVERY_CODE';
export type MfaPolicyType = 'OPTIONAL' | 'REQUIRED_FOR_ADMINS' | 'REQUIRED_FOR_ALL';

export const MFA_METHOD_CODE = {
  TOTP: 1,
  EMAIL_OTP: 2,
  RECOVERY_CODE: 3,
  SMS_OTP: 4,
} as const;

export const MFA_METHOD = MFA_METHOD_CODE;

export const MFA_METHOD_NAME: Record<number, MfaMethodType> = {
  1: 'TOTP',
  2: 'EMAIL_OTP',
  3: 'RECOVERY_CODE',
  4: 'SMS_OTP',
};

export type MfaMethodCode = (typeof MFA_METHOD_CODE)[keyof typeof MFA_METHOD_CODE];
export type MfaMethodName = MfaMethodType;

export const MFA_POLICY_CODE = {
  OPTIONAL: 1,
  REQUIRED_FOR_ADMINS: 2,
  REQUIRED_FOR_ALL: 3,
} as const;

export const MFA_POLICY = MFA_POLICY_CODE;

export type MfaPolicyCode = (typeof MFA_POLICY_CODE)[keyof typeof MFA_POLICY_CODE];
export type MfaPolicyName = MfaPolicyType;

export const PASSWORD_HASH_ALGO_CODE = {
  SCRYPT: 1,
  PBKDF2_SHA512: 2,
  PBKDF2_SHA256: 3,
} as const;

export const PASSWORD_HASH_ALGORITHM = PASSWORD_HASH_ALGO_CODE;

export type PasswordHashAlgoCode =
  (typeof PASSWORD_HASH_ALGO_CODE)[keyof typeof PASSWORD_HASH_ALGO_CODE];
export type PasswordHashAlgorithmCode = PasswordHashAlgoCode;
export type PasswordHashAlgorithmName = PasswordHashAlgorithm;

export const DB_ENCRYPTION_ALGO_CODE = {
  AES_256_GCM: 1,
  CHACHA20_POLY1305: 2,
  AES_256_CBC_HMAC: 3,
} as const;

export const DB_ENCRYPTION_ALGORITHM = DB_ENCRYPTION_ALGO_CODE;

export type DbEncryptionAlgoCode =
  (typeof DB_ENCRYPTION_ALGO_CODE)[keyof typeof DB_ENCRYPTION_ALGO_CODE];
export type DbEncryptionAlgorithmCode = DbEncryptionAlgoCode;
export type DbEncryptionAlgorithmName = DbEncryptionAlgorithm;

export function parseMfaMethodCode(val: unknown): MfaMethodCode {
  if (val === 1 || val === '1' || val === 'TOTP') return MFA_METHOD_CODE.TOTP;
  if (val === 2 || val === '2' || val === 'EMAIL_OTP') return MFA_METHOD_CODE.EMAIL_OTP;
  if (val === 3 || val === '3' || val === 'RECOVERY_CODE') return MFA_METHOD_CODE.RECOVERY_CODE;
  if (val === 4 || val === '4' || val === 'SMS_OTP') return MFA_METHOD_CODE.SMS_OTP;
  return MFA_METHOD_CODE.TOTP;
}

export function getMfaMethodName(code: number): MfaMethodType {
  if (code === MFA_METHOD_CODE.EMAIL_OTP) return 'EMAIL_OTP';
  if (code === MFA_METHOD_CODE.RECOVERY_CODE) return 'RECOVERY_CODE';
  if (code === MFA_METHOD_CODE.SMS_OTP) return 'SMS_OTP';
  return 'TOTP';
}

export function parseMfaPolicyCode(val: unknown): MfaPolicyCode {
  if (val === 2 || val === '2' || val === 'REQUIRED_FOR_ADMINS') {
    return MFA_POLICY_CODE.REQUIRED_FOR_ADMINS;
  }
  if (val === 3 || val === '3' || val === 'REQUIRED_FOR_ALL') {
    return MFA_POLICY_CODE.REQUIRED_FOR_ALL;
  }
  return MFA_POLICY_CODE.OPTIONAL;
}

export function getMfaPolicyName(code: number): MfaPolicyType {
  if (code === MFA_POLICY_CODE.REQUIRED_FOR_ADMINS) return 'REQUIRED_FOR_ADMINS';
  if (code === MFA_POLICY_CODE.REQUIRED_FOR_ALL) return 'REQUIRED_FOR_ALL';
  return 'OPTIONAL';
}

export function parsePasswordHashAlgoCode(val: unknown): PasswordHashAlgoCode {
  if (val === 2 || val === '2' || val === 'PBKDF2_SHA512') {
    return PASSWORD_HASH_ALGO_CODE.PBKDF2_SHA512;
  }
  if (val === 3 || val === '3' || val === 'PBKDF2_SHA256') {
    return PASSWORD_HASH_ALGO_CODE.PBKDF2_SHA256;
  }
  return PASSWORD_HASH_ALGO_CODE.SCRYPT;
}

export function getPasswordHashAlgoName(code: number): PasswordHashAlgorithm {
  if (code === PASSWORD_HASH_ALGO_CODE.PBKDF2_SHA512) return 'PBKDF2_SHA512';
  if (code === PASSWORD_HASH_ALGO_CODE.PBKDF2_SHA256) return 'PBKDF2_SHA256';
  return 'SCRYPT';
}

export function parseDbEncryptionAlgoCode(val: unknown): DbEncryptionAlgoCode {
  if (val === 2 || val === '2' || val === 'CHACHA20_POLY1305') {
    return DB_ENCRYPTION_ALGO_CODE.CHACHA20_POLY1305;
  }
  if (val === 3 || val === '3' || val === 'AES_256_CBC_HMAC') {
    return DB_ENCRYPTION_ALGO_CODE.AES_256_CBC_HMAC;
  }
  return DB_ENCRYPTION_ALGO_CODE.AES_256_GCM;
}

export function getDbEncryptionAlgoName(code: number): DbEncryptionAlgorithm {
  if (code === DB_ENCRYPTION_ALGO_CODE.CHACHA20_POLY1305) return 'CHACHA20_POLY1305';
  if (code === DB_ENCRYPTION_ALGO_CODE.AES_256_CBC_HMAC) return 'AES_256_CBC_HMAC';
  return 'AES_256_GCM';
}

export const getPasswordHashAlgorithmName = getPasswordHashAlgoName;
export const parsePasswordHashAlgorithm = parsePasswordHashAlgoCode;
export const getDbEncryptionAlgorithmName = getDbEncryptionAlgoName;
export const parseDbEncryptionAlgorithm = parseDbEncryptionAlgoCode;
export const parseMfaMethod = parseMfaMethodCode;
export const parseMfaPolicy = parseMfaPolicyCode;

export const STEP_UP_TOKEN_CACHE_PREFIX = 'auth:step_up:token:' as const;
export const PASSWORD_RESET_TTL_SECONDS = 900; // 15 phút
export const DEFAULT_RESET_OTP_MAX_ATTEMPTS = 5;

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

export const VALID_MFA_POLICIES: ReadonlySet<string> = new Set([
  'OPTIONAL',
  'REQUIRED_FOR_ADMINS',
  'REQUIRED_FOR_ALL',
]);

export const VALID_MFA_METHODS: ReadonlySet<string> = new Set([
  'TOTP',
  'EMAIL_OTP',
  'SMS_OTP',
  'RECOVERY_CODE',
]);

export const SECURITY_SETTING_DESCRIPTORS: readonly SecuritySettingDescriptor[] = [
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

export const DESCRIPTOR_BY_KEY = new Map<string, SecuritySettingDescriptor>(
  SECURITY_SETTING_DESCRIPTORS.map((d) => [d.key, d]),
);

export const CREDENTIALS_SETTING_KEYS = {
  PASSWORD_MIN_LENGTH: {
    key: 'security.password.min_length',
    defaultValue: 8,
  },
  PASSWORD_REQUIRE_UPPERCASE: {
    key: 'security.password.require_uppercase',
    defaultValue: true,
  },
  PASSWORD_REQUIRE_NUMBERS: {
    key: 'security.password.require_numbers',
    defaultValue: true,
  },
  PASSWORD_REQUIRE_SPECIAL_CHARS: {
    key: 'security.password.require_special_chars',
    defaultValue: false,
  },
  PASSWORD_REQUIRE_CURRENT_ON_CHANGE: {
    key: 'security.password.require_current_on_change',
    defaultValue: true,
  },
  PASSWORD_DISALLOW_USER_INFO: {
    key: 'security.password.disallow_user_info',
    defaultValue: true,
  },
  PASSWORD_DISALLOWED_LIST: {
    key: 'security.password.disallowed_list',
    defaultValue: DEFAULT_DISALLOWED_PASSWORDS,
  },
  PASSWORD_PREVENT_REUSE: {
    key: 'security.password.prevent_reuse',
    defaultValue: true,
  },
  PASSWORD_HISTORY_LIMIT: {
    key: 'security.password.history_limit',
    defaultValue: 5,
  },
  PASSWORD_REVOKE_SESSIONS_ON_CHANGE: {
    key: 'security.password.revoke_sessions_on_change',
    defaultValue: true,
  },
  PASSWORD_RESET_TTL_SECONDS: {
    key: 'security.password.reset_ttl_seconds',
    defaultValue: 900,
  },
  CRYPTO_PASSWORD_HASH_ALGORITHM: {
    key: 'security.crypto.password_hash_algorithm',
    defaultValue: 'SCRYPT',
  },
  CRYPTO_DB_ENCRYPTION_ALGORITHM: {
    key: 'security.crypto.db_encryption_algorithm',
    defaultValue: 'AES_256_GCM',
  },
  CRYPTO_ENCRYPT_FIELDS_AT_REST: {
    key: 'security.crypto.encrypt_fields_at_rest',
    defaultValue: true,
  },
  LOGIN_MAX_FAILED_ATTEMPTS: {
    key: 'security.login.max_failed_attempts',
    defaultValue: 5,
  },
  LOGIN_LOCKOUT_DURATION_MINUTES: {
    key: 'security.login.lockout_duration_minutes',
    defaultValue: 15,
  },
  MFA_POLICY: {
    key: 'security.mfa.policy',
    defaultValue: 'OPTIONAL',
  },
  MFA_ALLOWED_METHODS: {
    key: 'security.mfa.allowed_methods',
    defaultValue: ['TOTP', 'EMAIL_OTP', 'RECOVERY_CODE'] as readonly string[],
  },
  REGISTRATION_ALLOW_EMAIL: {
    key: 'security.registration.allow_email',
    defaultValue: true,
  },
  REGISTRATION_ALLOW_PHONE: {
    key: 'security.registration.allow_phone',
    defaultValue: true,
  },
  REGISTRATION_REQUIRE_EMAIL_VERIFICATION: {
    key: 'security.registration.require_email_verification',
    defaultValue: false,
  },
  REGISTRATION_REQUIRE_PHONE_VERIFICATION: {
    key: 'security.registration.require_phone_verification',
    defaultValue: false,
  },
  OTP_MAX_SEND_COUNT: {
    key: 'security.otp.max_send_count',
    defaultValue: 5,
  },
  OTP_MAX_ATTEMPTS: {
    key: 'security.otp.max_attempts',
    defaultValue: 5,
  },
  OTP_COOLDOWN_SECONDS: {
    key: 'security.otp.cooldown_seconds',
    defaultValue: 60,
  },
  SESSION_IDLE_TIMEOUT_MINUTES: {
    key: 'security.session.idle_timeout_minutes',
    defaultValue: 30,
  },
  SESSION_MAX_LIFETIME_MINUTES: {
    key: 'security.session.max_lifetime_minutes',
    defaultValue: 10080,
  },
  ENABLE_LOGIN_AUDIT_LOG: {
    key: 'security.audit.enable_login_log',
    defaultValue: true,
  },
} as const;

export const CREDENTIALS_AUDIT_META = {
  MODULE: 'credentials',
  ACTIONS: {
    PASSWORD_ADMIN_RESET: 'auth.password_admin_reset',
    SECURITY_SETTINGS_UPDATED: 'auth.security_settings_updated',
  },
} as const;
