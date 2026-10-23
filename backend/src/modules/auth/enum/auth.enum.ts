import type { SecuritySettingDescriptor } from '../types/auth.types.js';

// ============================================================================
// AUTH & STEP-UP DEFAULTS
// ============================================================================
export const STEP_UP_TOKEN_TTL_SECONDS = 300; // 5 phút
export const DEFAULT_ADMIN_ROLE_CODES: string[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'SYSTEM_ADMIN',
  'IAM_ADMIN',
  'SECURITY_ADMIN',
];

// ============================================================================
// MFA & CHALLENGE ATTEMPT DEFAULTS
// ============================================================================
export const EMAIL_OTP_TTL_SECONDS = 300; // 5 phút
export const SMS_OTP_TTL_SECONDS = 300; // 5 phút
export const DEFAULT_TRUSTED_DEVICE_DAYS = 30;
export const DEFAULT_MAX_TRUSTED_DEVICES = 20;
export const DEFAULT_RECOVERY_CODE_COUNT = 8;
export const DEFAULT_MFA_OTP_MAX_ATTEMPTS = 5;

export const MFA_CHALLENGE_ATTEMPT_TTL_SEC = 300;
export const MFA_CHALLENGE_MAX_L1_ENTRIES = 5000;
export const DEFAULT_MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const DEFAULT_AUTO_LOCK_DURATION_MINUTES = 15;

// ============================================================================
// SESSION & TOKEN DEFAULTS
// ============================================================================
export const AUTH_SESSION_REDIS_PREFIX = 'iam:auth:session:';
export const DEFAULT_ACCESS_TTL_SEC = 900; // 15m
export const DEFAULT_REFRESH_TTL_SEC = 604_800; // 7d
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30; // 30m
export const DEFAULT_MAX_LIFETIME_MINUTES = 10_080; // 7d

// ============================================================================
// PASSWORD & VERIFICATION DEFAULTS
// ============================================================================
export const PASSWORD_RESET_TTL_SECONDS = 900; // 15 phút
export const DEFAULT_RESET_OTP_MAX_ATTEMPTS = 5;

export const EMAIL_VERIFICATION_TTL_SECONDS = 900; // 15 phút
export const PHONE_OTP_TTL_SECONDS = 300; // 5 phút
export const DEFAULT_OTP_MAX_SENDS = 5;
export const DEFAULT_OTP_MAX_ATTEMPTS = 5;
export const DEFAULT_OTP_COOLDOWN_SECONDS = 60;

// ============================================================================
// SERVICE ACCOUNT & API CLIENT DEFAULTS
// ============================================================================
export const DEFAULT_CLIENT_TOKEN_TTL_SECONDS = 3600; // 1 giờ
export const MAX_USAGE_LOG_ENTRIES = 50;

// ============================================================================
// SECURITY SETTINGS & POLICY DESCRIPTORS
// ============================================================================
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
